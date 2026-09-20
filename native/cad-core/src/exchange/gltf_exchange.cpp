// glTF 2.0 mesh-profile exchange (hand-written, no external dep).

#include "exchange/gltf_exchange.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <sstream>

#include "exchange/sew.h"
#include "model/shapes.h"
#include "tessellation/mesh.h"

#if INTENTCAD_WITH_OCCT
#include <TopoDS_Shape.hxx>
#endif

namespace intentcad {

namespace {

// ── Minimal JSON DOM (strict subset: objects/arrays/strings/numbers) ──

struct Json {
  enum class Type { Null, Bool, Num, Str, Arr, Obj };
  Type type = Type::Null;
  bool b = false;
  double num = 0.0;
  std::string str;
  std::vector<Json> arr;
  std::vector<std::pair<std::string, Json>> obj;
  const Json* find(const std::string& key) const {
    if (type != Type::Obj) return nullptr;
    for (const auto& kv : obj)
      if (kv.first == key) return &kv.second;
    return nullptr;
  }
};

struct JsonParser {
  const char* p;
  const char* end;
  std::string* error;
  bool fail(const std::string& m) {
    if (error && error->empty()) *error = m;
    return false;
  }
  void skipWs() {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r'))
      ++p;
  }
  bool parseValue(Json* out) {
    skipWs();
    if (p >= end) return fail("unexpected end of JSON");
    if (*p == '{') return parseObj(out);
    if (*p == '[') return parseArr(out);
    if (*p == '"') {
      std::string s;
      if (!parseStr(&s)) return false;
      out->type = Json::Type::Str;
      out->str = std::move(s);
      return true;
    }
    if (*p == 't' && end - p >= 4 && std::strncmp(p, "true", 4) == 0) {
      p += 4;
      out->type = Json::Type::Bool;
      out->b = true;
      return true;
    }
    if (*p == 'f' && end - p >= 5 && std::strncmp(p, "false", 5) == 0) {
      p += 5;
      out->type = Json::Type::Bool;
      out->b = false;
      return true;
    }
    if (*p == 'n' && end - p >= 4 && std::strncmp(p, "null", 4) == 0) {
      p += 4;
      out->type = Json::Type::Null;
      return true;
    }
    return parseNum(out);
  }
  bool parseObj(Json* out) {
    ++p;  // {
    out->type = Json::Type::Obj;
    skipWs();
    if (p < end && *p == '}') {
      ++p;
      return true;
    }
    while (true) {
      skipWs();
      if (p >= end || *p != '"') return fail("expected string key");
      std::string key;
      if (!parseStr(&key)) return false;
      skipWs();
      if (p >= end || *p != ':') return fail("expected ':'");
      ++p;
      Json val;
      if (!parseValue(&val)) return false;
      out->obj.emplace_back(std::move(key), std::move(val));
      skipWs();
      if (p >= end) return fail("unterminated object");
      if (*p == ',') {
        ++p;
        continue;
      }
      if (*p == '}') {
        ++p;
        return true;
      }
      return fail("expected ',' or '}'");
    }
  }
  bool parseArr(Json* out) {
    ++p;  // [
    out->type = Json::Type::Arr;
    skipWs();
    if (p < end && *p == ']') {
      ++p;
      return true;
    }
    while (true) {
      Json val;
      if (!parseValue(&val)) return false;
      out->arr.push_back(std::move(val));
      skipWs();
      if (p >= end) return fail("unterminated array");
      if (*p == ',') {
        ++p;
        continue;
      }
      if (*p == ']') {
        ++p;
        return true;
      }
      return fail("expected ',' or ']'");
    }
  }
  bool parseStr(std::string* out) {
    ++p;  // opening "
    while (p < end && *p != '"') {
      // Strict JSON: raw control characters must be escaped.
      if (static_cast<unsigned char>(*p) < 0x20) {
        return fail("unescaped control character in string");
      }
      if (*p == '\\') {
        ++p;
        if (p >= end) return fail("bad escape");
        switch (*p) {
          case '"': out->push_back('"'); break;
          case '\\': out->push_back('\\'); break;
          case '/': out->push_back('/'); break;
          case 'b': out->push_back('\b'); break;
          case 'f': out->push_back('\f'); break;
          case 'n': out->push_back('\n'); break;
          case 'r': out->push_back('\r'); break;
          case 't': out->push_back('\t'); break;
          case 'u': {
            if (end - p < 5) return fail("bad \\u escape");
            unsigned cp = 0;
            for (int i = 1; i <= 4; ++i) {
              const char c = p[i];
              cp <<= 4;
              if (c >= '0' && c <= '9') cp |= static_cast<unsigned>(c - '0');
              else if (c >= 'a' && c <= 'f')
                cp |= static_cast<unsigned>(c - 'a' + 10);
              else if (c >= 'A' && c <= 'F')
                cp |= static_cast<unsigned>(c - 'A' + 10);
              else
                return fail("bad \\u escape");
            }
            // Minimal UTF-8 encode (names only — geometry never rides here).
            if (cp < 0x80)
              out->push_back(static_cast<char>(cp));
            else if (cp < 0x800) {
              out->push_back(static_cast<char>(0xC0 | (cp >> 6)));
              out->push_back(static_cast<char>(0x80 | (cp & 0x3F)));
            } else {
              out->push_back(static_cast<char>(0xE0 | (cp >> 12)));
              out->push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
              out->push_back(static_cast<char>(0x80 | (cp & 0x3F)));
            }
            p += 4;
            break;
          }
          default: return fail("bad escape");
        }
        ++p;
      } else {
        out->push_back(*p);
        ++p;
      }
    }
    if (p >= end) return fail("unterminated string");
    ++p;  // closing "
    return true;
  }
  bool parseNum(Json* out) {
    const char* start = p;
    // Strict JSON: no leading '+' (and no Infinity/NaN).
    if (p < end && *p == '-') ++p;
    bool any = false;
    while (p < end && *p >= '0' && *p <= '9') {
      ++p;
      any = true;
    }
    if (p < end && *p == '.') {
      ++p;
      while (p < end && *p >= '0' && *p <= '9') {
        ++p;
        any = true;
      }
    }
    if (p < end && (*p == 'e' || *p == 'E')) {
      ++p;
      if (p < end && (*p == '-' || *p == '+')) ++p;
      while (p < end && *p >= '0' && *p <= '9') ++p;
    }
    if (!any) return fail("expected number");
    try {
      out->type = Json::Type::Num;
      out->num = std::stod(std::string(start, p));
    } catch (...) {
      return fail("bad number");
    }
    return true;
  }
};

bool ParseJson(const std::string& text, Json* out, std::string* error) {
  JsonParser ps{text.data(), text.data() + text.size(), error};
  if (!ps.parseValue(out)) {
    if (error && error->empty()) *error = "invalid JSON";
    return false;
  }
  ps.skipWs();
  if (ps.p != ps.end) {
    if (error) *error = "trailing data after JSON document";
    return false;
  }
  return true;
}

const Json* Req(const Json& obj, const char* key, Json::Type t,
                std::string* error, const std::string& what) {
  const Json* v = obj.find(key);
  if (!v || v->type != t) {
    if (error) *error = "glTF: " + what + " missing '" + key + "'";
    return nullptr;
  }
  return v;
}

// ── base64 decode (data: URIs; encode twin lives in protocol/base64.h) ──

bool Base64Decode(const std::string& in, std::vector<uint8_t>* out,
                  std::string* error) {
  static const signed char kRev[256] = {};
  static signed char rev[256];
  static bool init = false;
  if (!init) {
    for (int i = 0; i < 256; ++i) rev[i] = -1;
    const char* alpha =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; ++i)
      rev[static_cast<unsigned char>(alpha[i])] = static_cast<signed char>(i);
    init = true;
  }
  (void)kRev;
  unsigned accum = 0;
  int bits = 0;
  for (char c : in) {
    if (c == '=') break;
    const signed char v = rev[static_cast<unsigned char>(c)];
    if (v < 0) {
      if (error) *error = "bad base64 in data URI";
      return false;
    }
    accum = (accum << 6) | static_cast<unsigned>(v);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out->push_back(static_cast<uint8_t>((accum >> bits) & 0xFF));
    }
  }
  return true;
}

bool ReadFileBytes(const std::string& path, std::vector<uint8_t>* out,
                   std::string* error) {
  // DoS bound (C9): never resize to an attacker's length prefix.
  constexpr size_t kMaxFileBytes = 512u * 1024u * 1024u;
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) {
    if (error) *error = "cannot open file: " + path;
    return false;
  }
  const std::streampos end = f.tellg();
  if (end < 0) {
    if (error) *error = "cannot stat file: " + path;
    return false;
  }
  if (static_cast<uint64_t>(end) > kMaxFileBytes) {
    if (error) *error = "file too large (over 512MB): " + path;
    return false;
  }
  f.seekg(0, std::ios::beg);
  out->resize(static_cast<size_t>(end));
  if (!out->empty() && !f.read(reinterpret_cast<char*>(out->data()),
                               static_cast<std::streamsize>(out->size()))) {
    if (error) *error = "cannot read file: " + path;
    return false;
  }
  return true;
}

// ── glTF interpretation (strict mesh profile) ──

struct GltfDoc {
  Json root;
  // Resolved buffers in order (external .bin, data: URIs, or GLB chunk).
  std::vector<std::vector<uint8_t>> buffers;
};

bool ResolveBuffers(const Json& root, const std::string& baseDir,
                    const std::vector<uint8_t>* glbBin, GltfDoc* doc,
                    std::string* error) {
  const Json* buffers = root.find("buffers");
  if (!buffers || buffers->type != Json::Type::Arr || buffers->arr.empty()) {
    if (error) *error = "glTF: no buffers";
    return false;
  }
  for (const Json& b : buffers->arr) {
    if (b.type != Json::Type::Obj) {
      if (error) *error = "glTF: bad buffer entry";
      return false;
    }
    std::vector<uint8_t> bytes;
    const Json* uri = b.find("uri");
    if (glbBin) {
      // One BIN chunk serves buffer 0; multi-buffer GLB would alias it.
      if (uri || buffers->arr.size() > 1) {
        if (error) *error = "glTF: multi-buffer GLB unsupported";
        return false;
      }
      bytes = *glbBin;
    } else if (!uri || uri->type != Json::Type::Str) {
      if (error) *error = "glTF: buffer without uri (GLB?)";
      return false;
    } else if (uri->str.rfind("data:", 0) == 0) {
      const size_t comma = uri->str.find(',');
      if (comma == std::string::npos ||
          uri->str.find(";base64,") == std::string::npos) {
        if (error) *error = "glTF: only base64 data URIs supported";
        return false;
      }
      if (!Base64Decode(uri->str.substr(comma + 1), &bytes, error)) {
        if (error) *error = "glTF: " + *error;
        return false;
      }
    } else {
      // External file: stay inside the document directory (no traversal).
      if (uri->str.find("..") != std::string::npos) {
        if (error) *error = "glTF: buffer path escapes document directory";
        return false;
      }
      if (!ReadFileBytes(baseDir + "/" + uri->str, &bytes, error)) {
        if (error) *error = "glTF: " + *error;
        return false;
      }
    }
    const Json* declared = b.find("byteLength");
    if (declared && declared->type == Json::Type::Num &&
        static_cast<size_t>(declared->num) > bytes.size()) {
      if (error) *error = "glTF: buffer shorter than byteLength";
      return false;
    }
    doc->buffers.push_back(std::move(bytes));
  }
  return true;
}

struct AccessorView {
  const uint8_t* data = nullptr;
  size_t count = 0;
  int numComps = 0;  // 1 SCALAR, 3 VEC3
  int compSize = 0;  // 2 u16, 4 f32/u32
  bool isFloat = false;
};

bool ResolveAccessor(const Json& root, const GltfDoc& doc, size_t index,
                     const char* wantType, bool floatOnly,
                     AccessorView* out, std::string* error) {
  const Json* accessors = root.find("accessors");
  const Json* bufferViews = root.find("bufferViews");
  if (!accessors || accessors->type != Json::Type::Arr ||
      index >= accessors->arr.size()) {
    if (error) *error = "glTF: bad accessor index";
    return false;
  }
  const Json& a = accessors->arr[index];
  const Json* type = Req(a, "type", Json::Type::Str, error, "accessor");
  if (!type) return false;
  if (type->str != wantType) {
    if (error) *error = std::string("glTF: accessor must be ") + wantType;
    return false;
  }
  const Json* comp = Req(a, "componentType", Json::Type::Num, error, "accessor");
  if (!comp) return false;
  const int ct = static_cast<int>(comp->num);
  const bool isFloat = (ct == 5126);
  const bool isU16 = (ct == 5123);
  const bool isU32 = (ct == 5125);
  if ((!isFloat && !(isU16 || isU32)) || (floatOnly && !isFloat)) {
    if (error) *error = "glTF: unsupported componentType (float/u16/u32 only)";
    return false;
  }
  const Json* count = Req(a, "count", Json::Type::Num, error, "accessor");
  if (!count || count->num <= 0) {
    if (error) *error = "glTF: accessor with no elements";
    return false;
  }
  const Json* norm = a.find("normalized");
  if (norm && norm->type == Json::Type::Bool && norm->b) {
    if (error) *error = "glTF: normalized accessors unsupported";
    return false;
  }
  const Json* bvIdx = Req(a, "bufferView", Json::Type::Num, error, "accessor");
  if (!bvIdx) return false;
  if (!bufferViews || bufferViews->type != Json::Type::Arr ||
      static_cast<size_t>(bvIdx->num) >= bufferViews->arr.size()) {
    if (error) *error = "glTF: bad bufferView index";
    return false;
  }
  const Json& bv = bufferViews->arr[static_cast<size_t>(bvIdx->num)];
  const Json* bufIdx = Req(bv, "buffer", Json::Type::Num, error, "bufferView");
  if (!bufIdx || static_cast<size_t>(bufIdx->num) >= doc.buffers.size()) {
    if (error) *error = "glTF: bad buffer index";
    return false;
  }
  const std::vector<uint8_t>& buf = doc.buffers[static_cast<size_t>(bufIdx->num)];
  size_t bvOff = 0;
  if (const Json* o = bv.find("byteOffset")) {
    if (o->type != Json::Type::Num) {
      if (error) *error = "glTF: bad bufferView byteOffset";
      return false;
    }
    bvOff = static_cast<size_t>(o->num);
  }
  if (const Json* stride = bv.find("byteStride")) {
    // Strict profile: interleaved layouts rejected honestly.
    const int comps = (type->str == "VEC3") ? 3 : 1;
    const int elem = comps * (isFloat ? 4 : (isU16 ? 2 : 4));
    if (stride->type != Json::Type::Num ||
        static_cast<size_t>(stride->num) != static_cast<size_t>(elem)) {
      if (error) *error = "glTF: interleaved bufferViews unsupported";
      return false;
    }
  }
  size_t accOff = 0;
  if (const Json* o = a.find("byteOffset")) {
    if (o->type != Json::Type::Num) {
      if (error) *error = "glTF: bad accessor byteOffset";
      return false;
    }
    accOff = static_cast<size_t>(o->num);
  }
  const int comps = (type->str == "VEC3") ? 3 : 1;
  const int elem = comps * (isFloat ? 4 : (isU16 ? 2 : 4));
  const size_t start = bvOff + accOff;
  const size_t need = static_cast<size_t>(count->num) * static_cast<size_t>(elem);
  if (start + need > buf.size()) {
    if (error) *error = "glTF: accessor reads past buffer end";
    return false;
  }
  out->data = buf.data() + start;
  out->count = static_cast<size_t>(count->num);
  out->numComps = comps;
  out->compSize = isFloat ? 4 : (isU16 ? 2 : 4);
  out->isFloat = isFloat;
  return true;
}

float ReadF32(const uint8_t* p) {
  float v = 0;
  std::memcpy(&v, p, 4);
  return v;
}

uint32_t ReadU(const AccessorView& v, size_t i) {
  const uint8_t* p = v.data + i * static_cast<size_t>(v.compSize);
  if (v.compSize == 2) {
    uint16_t u = 0;
    std::memcpy(&u, p, 2);
    return u;
  }
  uint32_t u = 0;
  std::memcpy(&u, p, 4);
  return u;
}

// 4x4 column-major node transform (glTF `matrix`, TRS, or identity).
struct Mat4 {
  double m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
};

bool NodeTransform(const Json& node, Mat4* out, std::string* error) {
  if (const Json* mx = node.find("matrix")) {
    if (mx->type != Json::Type::Arr || mx->arr.size() != 16) {
      if (error) *error = "glTF: node matrix must have 16 numbers";
      return false;
    }
    for (int i = 0; i < 16; ++i) {
      if (mx->arr[i].type != Json::Type::Num) {
        if (error) *error = "glTF: bad node matrix";
        return false;
      }
      out->m[i] = mx->arr[i].num;
    }
    return true;
  }
  double t[3] = {0, 0, 0};
  double q[4] = {0, 0, 0, 1};
  double s[3] = {1, 1, 1};
  auto readVec = [&](const char* key, double* dst, int n) -> bool {
    if (const Json* v = node.find(key)) {
      if (v->type != Json::Type::Arr || v->arr.size() != static_cast<size_t>(n)) {
        if (error) *error = std::string("glTF: bad node ") + key;
        return false;
      }
      for (int i = 0; i < n; ++i) {
        if (v->arr[i].type != Json::Type::Num) {
          if (error) *error = std::string("glTF: bad node ") + key;
          return false;
        }
        dst[i] = v->arr[i].num;
      }
    }
    return true;
  };
  if (!readVec("translation", t, 3) || !readVec("rotation", q, 4) ||
      !readVec("scale", s, 3)) {
    return false;
  }
  // Normalize the quaternion (M5): un-normalized input would skew R.
  {
    const double l = std::sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] +
                               q[3] * q[3]);
    if (!(l > 0) || !std::isfinite(l)) {
      if (error) *error = "glTF: node rotation is not a quaternion";
      return false;
    }
    q[0] /= l;
    q[1] /= l;
    q[2] /= l;
    q[3] /= l;
  }
  // quat → 3x3 (column-major), then T * R * S.
  const double x = q[0], y = q[1], z = q[2], w = q[3];
  const double r[9] = {
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)};
  for (int c = 0; c < 3; ++c)
    for (int rI = 0; rI < 3; ++rI)
      out->m[c * 4 + rI] = r[c * 3 + rI] * s[c];
  out->m[12] = t[0];
  out->m[13] = t[1];
  out->m[14] = t[2];
  return true;
}

// glTF Y-up meters → model Z-up mm (inverse of the writer mapping).
inline void ToModel(double x, double y, double z, float* ox, float* oy,
                    float* oz) {
  *ox = static_cast<float>(x * 1000.0);
  *oy = static_cast<float>(-z * 1000.0);
  *oz = static_cast<float>(y * 1000.0);
}

}  // namespace

#if INTENTCAD_WITH_OCCT
namespace {

// Column-major 4x4 product (glTF node hierarchy, C7).
Mat4 MulMat4(const Mat4& a, const Mat4& b) {
  Mat4 o;
  for (int c = 0; c < 4; ++c) {
    for (int r = 0; r < 4; ++r) {
      o.m[c * 4 + r] = a.m[r] * b.m[c * 4] + a.m[4 + r] * b.m[c * 4 + 1] +
                       a.m[8 + r] * b.m[c * 4 + 2] +
                       a.m[12 + r] * b.m[c * 4 + 3];
    }
  }
  return o;
}

// One (world, mesh) pair sewn into model-space soup (mm, Z-up).
bool ReadMeshNode(const Json& root, const GltfDoc& doc, const Mat4& world,
                  size_t meshIndex, std::vector<float>* verts,
                  std::vector<uint32_t>* indices, std::string* error) {
  const Json* meshes = root.find("meshes");
  if (!meshes || meshes->type != Json::Type::Arr ||
      meshIndex >= meshes->arr.size()) {
    if (error) *error = "glTF: bad mesh index";
    return false;
  }
  const Json& mesh = meshes->arr[meshIndex];
  const Json* prims = mesh.find("primitives");
  if (!prims || prims->type != Json::Type::Arr || prims->arr.empty()) {
    if (error) *error = "glTF: mesh without primitives";
    return false;
  }
  Mat4 xf = world;
  auto xPoint = [&](double x, double y, double z, float* o) {
    // Column-major 4x4, then Y-up/m → Z-up/mm.
    const double wx = xf.m[0] * x + xf.m[4] * y + xf.m[8] * z + xf.m[12];
    const double wy = xf.m[1] * x + xf.m[5] * y + xf.m[9] * z + xf.m[13];
    const double wz = xf.m[2] * x + xf.m[6] * y + xf.m[10] * z + xf.m[14];
    ToModel(wx, wy, wz, o, o + 1, o + 2);
  };
  auto xNormal = [&](double x, double y, double z, float* o) {
    double nx = xf.m[0] * x + xf.m[4] * y + xf.m[8] * z;
    double ny = xf.m[1] * x + xf.m[5] * y + xf.m[9] * z;
    double nz = xf.m[2] * x + xf.m[6] * y + xf.m[10] * z;
    const double l = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 0) {
      nx /= l;
      ny /= l;
      nz /= l;
    }
    // Rotation part of Y-up→Z-up (no translation, no scale).
    *o = static_cast<float>(nx);
    *(o + 1) = static_cast<float>(-nz);
    *(o + 2) = static_cast<float>(ny);
  };
  for (const Json& prim : prims->arr) {
    if (prim.type != Json::Type::Obj) {
      if (error) *error = "glTF: bad primitive";
      return false;
    }
    if (const Json* mode = prim.find("mode")) {
      if (mode->type != Json::Type::Num || static_cast<int>(mode->num) != 4) {
        if (error) *error = "glTF: only triangle meshes (mode 4) supported";
        return false;
      }
    }
    const Json* attrs = prim.find("attributes");
    if (!attrs || attrs->type != Json::Type::Obj) {
      if (error) *error = "glTF: primitive without attributes";
      return false;
    }
    const Json* posIdx = attrs->find("POSITION");
    if (!posIdx || posIdx->type != Json::Type::Num) {
      if (error) *error = "glTF: primitive without POSITION";
      return false;
    }
    AccessorView pos;
    if (!ResolveAccessor(root, doc, static_cast<size_t>(posIdx->num), "VEC3",
                         true, &pos, error)) {
      return false;
    }
    const Json* nrmIdx = attrs->find("NORMAL");
    AccessorView nrm;
    bool hasNrm = false;
    if (nrmIdx && nrmIdx->type == Json::Type::Num) {
      if (!ResolveAccessor(root, doc, static_cast<size_t>(nrmIdx->num), "VEC3",
                           true, &nrm, error)) {
        return false;
      }
      if (nrm.count != pos.count) {
        if (error) *error = "glTF: POSITION/NORMAL count mismatch";
        return false;
      }
      hasNrm = true;
    }
    const uint32_t base = static_cast<uint32_t>(verts->size() / 3);
    for (size_t i = 0; i < pos.count; ++i) {
      float o[3];
      xPoint(ReadF32(pos.data + i * 12), ReadF32(pos.data + i * 12 + 4),
             ReadF32(pos.data + i * 12 + 8), o);
      verts->insert(verts->end(), {o[0], o[1], o[2]});
    }
    if (const Json* idx = prim.find("indices")) {
      if (idx->type != Json::Type::Num) {
        if (error) *error = "glTF: bad indices accessor";
        return false;
      }
      AccessorView iv;
      if (!ResolveAccessor(root, doc, static_cast<size_t>(idx->num), "SCALAR",
                           false, &iv, error)) {
        return false;
      }
      if (iv.count % 3 != 0) {
        if (error) *error = "glTF: index count not a multiple of 3";
        return false;
      }
      for (size_t i = 0; i < iv.count; ++i) {
        const uint32_t v = ReadU(iv, i);
        if (v >= pos.count) {
          if (error) *error = "glTF: index out of range";
          return false;
        }
        indices->push_back(base + v);
      }
    } else {
      // Non-indexed soup: every three vertices are one triangle.
      if (pos.count % 3 != 0) {
        if (error) *error = "glTF: vertex count not a multiple of 3";
        return false;
      }
      for (size_t i = 0; i < pos.count; ++i)
        indices->push_back(base + static_cast<uint32_t>(i));
    }
    (void)hasNrm;
    (void)xNormal;
  }
  return true;
}

}  // namespace
#endif

#if INTENTCAD_WITH_OCCT
namespace {

// Shared .gltf/.glb document builder (minor: .glb write removes the
// asymmetry of read-only GLB). Tessellated blocks + JSON text; callers add
// the container (.bin sidecar vs GLB chunks).
struct Block {
  std::string name;
  size_t nv = 0;
  size_t nt = 0;
  size_t posOff = 0;
  size_t nrmOff = 0;
  size_t idxOff = 0;
  float pmin[3] = {1e30f, 1e30f, 1e30f};
  float pmax[3] = {-1e30f, -1e30f, -1e30f};
};

struct TessMesh {
  std::string name;
  CoreMesh mesh;
};

bool CollectTessellated(std::vector<TessMesh>* out, std::string* error) {
  std::vector<std::string> skipped;
  for (const ShapeRecord& rec : ShapeStore::instance().listInOrder()) {
    if (rec.shape.IsNull()) continue;
    std::string terr;
    CoreMesh mesh = TessellateRecord(rec, 2, &terr);
    // Fail LOUD on partial export (M6): a file missing a body with an "ok"
    // status is silent corruption — name the bodies instead.
    if (mesh.indices.empty() || mesh.positions.empty()) {
      skipped.push_back(rec.featureId);
      continue;
    }
    out->push_back({rec.featureId + " " + rec.type, std::move(mesh)});
  }
  if (!skipped.empty()) {
    if (error) {
      *error = "cannot tessellate for export: " + skipped[0];
      for (size_t i = 1; i < skipped.size(); ++i)
        *error += ", " + skipped[i];
    }
    return false;
  }
  if (out->empty()) {
    if (error) *error = "nothing to export: the document has no solids";
    return false;
  }
  return true;
}

void FillBlocks(const std::vector<TessMesh>& meshes, std::vector<Block>* blocks,
                std::vector<uint8_t>* bin) {
  for (const TessMesh& src : meshes) {
    const CoreMesh& m = src.mesh;
    Block b;
    b.name = src.name;
    b.nv = m.positions.size() / 3;
    b.nt = m.indices.size() / 3;
    b.posOff = bin->size();
    for (size_t v = 0; v < b.nv; ++v) {
      const float p[3] = {m.positions[v * 3] / 1000.0f,
                          m.positions[v * 3 + 2] / 1000.0f,
                          -m.positions[v * 3 + 1] / 1000.0f};
      for (int k = 0; k < 3; ++k) {
        b.pmin[k] = std::min(b.pmin[k], p[k]);
        b.pmax[k] = std::max(b.pmax[k], p[k]);
        const uint8_t* by = reinterpret_cast<const uint8_t*>(&p[k]);
        bin->insert(bin->end(), by, by + 4);
      }
    }
    b.nrmOff = bin->size();
    for (size_t v = 0; v < b.nv; ++v) {
      const float n[3] = {m.normals[v * 3], m.normals[v * 3 + 2],
                          -m.normals[v * 3 + 1]};
      for (int k = 0; k < 3; ++k) {
        const uint8_t* by = reinterpret_cast<const uint8_t*>(&n[k]);
        bin->insert(bin->end(), by, by + 4);
      }
    }
    b.idxOff = bin->size();
    for (size_t t = 0; t < b.nt * 3; ++t) {
      const uint32_t id = m.indices[t];
      const uint8_t* by = reinterpret_cast<const uint8_t*>(&id);
      bin->insert(bin->end(), by, by + 4);
    }
    blocks->push_back(std::move(b));
  }
}

void EscapeJsonString(const std::string& in, std::ostringstream* out) {
  for (char c : in) {
    if (c == '"' || c == '\\') {
      *out << '\\';
      *out << c;
    } else if (static_cast<unsigned char>(c) < 0x20) {
      continue;  // controls never belong in names; drop, don't emit
    } else {
      *out << c;
    }
  }
}

// binUri empty → GLB-style buffer entry (no uri); else .gltf with uri.
std::string BuildJsonText(const std::vector<Block>& blocks,
                          const std::vector<uint8_t>& bin,
                          const std::string& binUri) {
  std::ostringstream json;
  json << std::setprecision(9);
  json << "{\"asset\":{\"version\":\"2.0\",\"generator\":\"INTENT-CAD\"},";
  json << "\"scene\":0,\"scenes\":[{\"nodes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) json << (i ? "," : "") << i;
  json << "]}],\"nodes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    json << (i ? "," : "") << "{\"mesh\":" << i << ",\"name\":\"";
    EscapeJsonString(blocks[i].name, &json);
    json << "\"}";
  }
  json << "],\"meshes\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    json << (i ? "," : "") << "{\"name\":\"mesh" << i
         << "\",\"primitives\":[{\"attributes\":{\"POSITION\":" << i * 3
         << ",\"NORMAL\":" << i * 3 + 1 << "},\"indices\":" << i * 3 + 2
         << "}]}";
  }
  json << "],\"bufferViews\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    const Block& b = blocks[i];
    json << (i ? "," : "")
         << "{\"buffer\":0,\"byteOffset\":" << b.posOff << ",\"byteLength\":"
         << b.nv * 12 << ",\"target\":34962}"
         << ",{\"buffer\":0,\"byteOffset\":" << b.nrmOff << ",\"byteLength\":"
         << b.nv * 12 << ",\"target\":34962}"
         << ",{\"buffer\":0,\"byteOffset\":" << b.idxOff << ",\"byteLength\":"
         << b.nt * 12 << ",\"target\":34963}";
  }
  json << "],\"accessors\":[";
  for (size_t i = 0; i < blocks.size(); ++i) {
    const Block& b = blocks[i];
    json << (i ? "," : "")
         << "{\"bufferView\":" << i * 3 << ",\"componentType\":5126"
         << ",\"count\":" << b.nv << ",\"type\":\"VEC3\""
         << ",\"min\":[" << b.pmin[0] << "," << b.pmin[1] << "," << b.pmin[2]
         << "]"
         << ",\"max\":[" << b.pmax[0] << "," << b.pmax[1] << "," << b.pmax[2]
         << "]}"
         << ",{\"bufferView\":" << i * 3 + 1 << ",\"componentType\":5126"
         << ",\"count\":" << b.nv << ",\"type\":\"VEC3\"}"
         << ",{\"bufferView\":" << i * 3 + 2 << ",\"componentType\":5125"
         << ",\"count\":" << b.nt * 3 << ",\"type\":\"SCALAR\"}";
  }
  json << "],\"buffers\":[{\"byteLength\":" << bin.size();
  if (!binUri.empty()) {
    json << ",\"uri\":\"";
    EscapeJsonString(binUri, &json);
    json << "\"";
  }
  json << "}]}";
  return json.str();
}

bool WriteBytes(const std::string& path, const void* data, size_t n,
                std::string* error) {
  std::ofstream f(path, std::ios::binary);
  if (!f) {
    if (error) *error = "cannot write file: " + path;
    return false;
  }
  if (n > 0) {
    f.write(static_cast<const char*>(data), static_cast<std::streamsize>(n));
  }
  f.close();
  if (!f) {
    if (error) *error = "cannot write file: " + path;
    return false;
  }
  return true;
}

std::string StemOf(const std::string& path) {
  const size_t dot = path.find_last_of('.');
  const size_t sep = path.find_last_of("/\\");
  if (dot != std::string::npos && (sep == std::string::npos || dot > sep)) {
    return path.substr(0, dot);
  }
  return path;
}

}  // namespace
#endif

bool ExportGltf(const std::string& path, std::string* error) {
#if INTENTCAD_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  // Tessellate first (also validates the doc has solids) — exact errors.
  std::vector<TessMesh> meshes;
  if (!CollectTessellated(&meshes, error)) return false;
  try {
    // .bin sidecar next to the .gltf (same stem).
    const std::string binPath = StemOf(path) + ".bin";
    const size_t binSep = binPath.find_last_of("/\\");
    const std::string binName =
        binSep == std::string::npos ? binPath : binPath.substr(binSep + 1);
    // Model Z-up mm → glTF Y-up m: (x, y, z) → (x/1000, z/1000, −y/1000).
    std::vector<Block> blocks;
    std::vector<uint8_t> bin;
    FillBlocks(meshes, &blocks, &bin);
    const std::string text = BuildJsonText(blocks, bin, binName);
    if (!WriteBytes(binPath, bin.data(), bin.size(), error)) return false;
    if (!WriteBytes(path, text.data(), text.size(), error)) return false;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("glTF export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "glTF export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ExportGlb(const std::string& path, std::string* error) {
#if INTENTCAD_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  std::vector<TessMesh> meshes;
  if (!CollectTessellated(&meshes, error)) return false;
  try {
    std::vector<Block> blocks;
    std::vector<uint8_t> bin;
    FillBlocks(meshes, &blocks, &bin);
    const std::string text = BuildJsonText(blocks, bin, "");
    // GLB container: 12-byte header + JSON chunk + BIN chunk, chunk
    // payloads 4-byte padded (spaces for JSON, zeros for BIN).
    const size_t jsonPad = (4 - (text.size() % 4)) % 4;
    const size_t binPad = (4 - (bin.size() % 4)) % 4;
    const uint32_t total = static_cast<uint32_t>(
        12 + 8 + text.size() + jsonPad + 8 + bin.size() + binPad);
    std::vector<uint8_t> out;
    out.reserve(total);
    auto put32 = [&](uint32_t v) {
      out.push_back(static_cast<uint8_t>(v & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
      out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
    };
    put32(0x46546C67);
    put32(2);
    put32(total);
    put32(static_cast<uint32_t>(text.size() + jsonPad));
    put32(0x4E4F534A);
    out.insert(out.end(), text.begin(), text.end());
    out.insert(out.end(), jsonPad, ' ');
    put32(static_cast<uint32_t>(bin.size() + binPad));
    put32(0x004E4942);
    out.insert(out.end(), bin.begin(), bin.end());
    out.insert(out.end(), binPad, 0);
    if (!WriteBytes(path, out.data(), out.size(), error)) return false;
    return true;
  } catch (const Standard_Failure& f) {
    if (error) *error = std::string("GLB export failed: ") + f.what();
    return false;
  }
#else
  (void)path;
  if (error) *error = "GLB export requires OCCT (link via vcpkg)";
  return false;
#endif
}

bool ImportGltf(const std::string& path, std::vector<std::string>* createdIds,
                std::string* error) {
#if INTENTCAD_WITH_OCCT
  if (path.empty()) {
    if (error) *error = "path is required";
    return false;
  }
  if (!createdIds) {
    if (error) *error = "internal error: null out-param";
    return false;
  }
  // Load .gltf (JSON + external/data buffers) or .glb (JSON + BIN chunks).
  std::string text;
  std::vector<uint8_t> glbBin;
  bool isGlb = false;
  {
    std::string lower = path;
    for (char& c : lower) c = static_cast<char>(std::tolower(c));
    isGlb = lower.size() >= 4 && lower.compare(lower.size() - 4, 4, ".glb") == 0;
  }
  if (isGlb) {
    std::vector<uint8_t> bytes;
    if (!ReadFileBytes(path, &bytes, error)) {
      if (error) *error = "glTF: " + *error;
      return false;
    }
    if (bytes.size() < 12) {
      if (error) *error = "glTF: truncated GLB header";
      return false;
    }
    uint32_t magic = 0, version = 0, length = 0;
    std::memcpy(&magic, bytes.data(), 4);
    std::memcpy(&version, bytes.data() + 4, 4);
    std::memcpy(&length, bytes.data() + 8, 4);
    if (magic != 0x46546C67 || version != 2 || length != bytes.size()) {
      if (error) *error = "glTF: bad GLB header (magic/version/length)";
      return false;
    }
    size_t off = 12;
    bool haveJson = false;
    while (off + 8 <= bytes.size()) {
      uint32_t chunkLen = 0, chunkType = 0;
      std::memcpy(&chunkLen, bytes.data() + off, 4);
      std::memcpy(&chunkType, bytes.data() + off + 4, 4);
      off += 8;
      if (off + chunkLen > bytes.size()) {
        if (error) *error = "glTF: truncated GLB chunk";
        return false;
      }
      if (chunkType == 0x4E4F534A) {  // JSON
        if (haveJson) {
          if (error) *error = "glTF: duplicate GLB JSON chunk";
          return false;
        }
        text.assign(reinterpret_cast<const char*>(bytes.data() + off),
                    chunkLen);
        haveJson = true;
      } else if (chunkType == 0x004E4942) {  // BIN
        // Spec order is JSON-then-BIN; a BIN chunk before any JSON means a
        // malformed container, not data to trust.
        if (!haveJson) {
          if (error) *error = "glTF: GLB BIN chunk before JSON chunk";
          return false;
        }
        if (!glbBin.empty()) {
          if (error) *error = "glTF: multi-BIN GLB unsupported";
          return false;
        }
        glbBin.assign(bytes.data() + off, bytes.data() + off + chunkLen);
      }
      off += chunkLen;
    }
    if (!haveJson) {
      if (error) *error = "glTF: GLB without JSON chunk";
      return false;
    }
  } else {
    std::vector<uint8_t> bytes;
    if (!ReadFileBytes(path, &bytes, error)) {
      if (error) *error = "glTF: " + *error;
      return false;
    }
    text.assign(reinterpret_cast<const char*>(bytes.data()), bytes.size());
  }
  Json root;
  {
    std::string perr;
    if (!ParseJson(text, &root, &perr) || root.type != Json::Type::Obj) {
      if (error) *error = "glTF: invalid JSON (" + perr + ")";
      return false;
    }
  }
  const Json* asset = root.find("asset");
  const Json* version =
      asset && asset->type == Json::Type::Obj ? asset->find("version") : nullptr;
  if (!version || version->type != Json::Type::Str ||
      version->str.rfind("2.", 0) != 0) {
    if (error) *error = "glTF: only 2.x assets supported";
    return false;
  }
  GltfDoc doc;
  doc.root = root;
  {
    std::string baseDir = ".";
    const size_t sep = path.find_last_of("/\\");
    if (sep != std::string::npos) baseDir = path.substr(0, sep);
    if (!ResolveBuffers(root, baseDir, isGlb ? &glbBin : nullptr, &doc,
                        error)) {
      // ResolveBuffers prefixes its own errors; pass through.
      return false;
    }
  }
  // Scene traversal (C7): DFS from scene roots, threading parent→child
  // world transforms. Nested meshes land in world space; nothing is
  // silently dropped. Cycle guard via depth cap (glTF forbids cycles, but
  // hostile files should error, not recurse forever).
  std::vector<std::pair<Mat4, size_t>> nodeMeshes;  // (world, meshIdx)
  {
    const Json* nodes = root.find("nodes");
    if (!nodes || nodes->type != Json::Type::Arr) {
      if (error) *error = "glTF: no nodes";
      return false;
    }
    std::vector<size_t> inScene;
    size_t sceneIdx = 0;
    if (const Json* s = root.find("scene")) {
      if (s->type != Json::Type::Num) {
        if (error) *error = "glTF: bad scene index";
        return false;
      }
      sceneIdx = static_cast<size_t>(s->num);
    }
    if (const Json* scenes = root.find("scenes")) {
      if (scenes->type != Json::Type::Arr ||
          sceneIdx >= scenes->arr.size()) {
        if (error) *error = "glTF: bad scene index";
        return false;
      }
      const Json& scene = scenes->arr[sceneIdx];
      if (const Json* sn = scene.find("nodes")) {
        if (sn->type != Json::Type::Arr) {
          if (error) *error = "glTF: bad scene nodes";
          return false;
        }
        for (const Json& n : sn->arr) {
          if (n.type != Json::Type::Num ||
              static_cast<size_t>(n.num) >= nodes->arr.size()) {
            if (error) *error = "glTF: bad scene node index";
            return false;
          }
          inScene.push_back(static_cast<size_t>(n.num));
        }
      } else {
        for (size_t i = 0; i < nodes->arr.size(); ++i) inScene.push_back(i);
      }
    } else {
      for (size_t i = 0; i < nodes->arr.size(); ++i) inScene.push_back(i);
    }
    struct Frame {
      size_t index;
      Mat4 world;
      int depth;
    };
    std::vector<Frame> stack;
    for (size_t ni : inScene) stack.push_back({ni, Mat4(), 0});
    while (!stack.empty()) {
      Frame fr = stack.back();
      stack.pop_back();
      if (fr.depth > 64) {
        if (error) *error = "glTF: node hierarchy too deep";
        return false;
      }
      if (fr.index >= nodes->arr.size()) {
        if (error) *error = "glTF: bad node index";
        return false;
      }
      const Json& node = nodes->arr[fr.index];
      if (node.type != Json::Type::Obj) continue;
      Mat4 local;
      // NodeTransform prefixes its own errors; pass through.
      if (!NodeTransform(node, &local, error)) return false;
      const Mat4 world = MulMat4(fr.world, local);
      if (const Json* m = node.find("mesh")) {
        if (m->type != Json::Type::Num) {
          if (error) *error = "glTF: bad mesh index";
          return false;
        }
        nodeMeshes.emplace_back(world, static_cast<size_t>(m->num));
      }
      if (const Json* kids = node.find("children")) {
        if (kids->type != Json::Type::Arr) {
          if (error) *error = "glTF: bad children";
          return false;
        }
        for (const Json& k : kids->arr) {
          if (k.type != Json::Type::Num ||
              static_cast<size_t>(k.num) >= nodes->arr.size()) {
            if (error) *error = "glTF: bad child index";
            return false;
          }
          stack.push_back(
              {static_cast<size_t>(k.num), world, fr.depth + 1});
        }
      }
    }
  }
  if (nodeMeshes.empty()) {
    if (error) *error = "glTF: scene has no meshes";
    return false;
  }
  std::vector<TopoDS_Shape> solids;
  for (const auto& nm : nodeMeshes) {
    std::vector<float> verts;
    std::vector<uint32_t> indices;
    // ReadMeshNode prefixes its own errors; pass through.
    if (!ReadMeshNode(root, doc, nm.first, nm.second, &verts, &indices,
                      error)) {
      return false;
    }
    if (!SewTrianglesToSolids(verts, indices, &solids, error)) {
      if (error) *error = "glTF: " + *error;
      return false;
    }
  }
  if (solids.empty()) {
    if (error) *error = "glTF: no closed solids";
    return false;
  }
  // One OCAF command for the whole import (shared helper).
  if (!CommitImportedSolids(solids, "MeshImport", "gltf-", createdIds, error)) {
    return false;
  }
  return true;
#else
  (void)path;
  (void)createdIds;
  if (error) *error = "glTF import requires OCCT (link via vcpkg)";
  return false;
#endif
}

}  // namespace intentcad
