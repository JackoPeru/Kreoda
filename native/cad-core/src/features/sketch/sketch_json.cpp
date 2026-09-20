#include "sketch_json.h"

#include <cctype>
#include <iomanip>
#include <sstream>
#include <vector>

namespace kreoda {

namespace {

std::string Trim(const std::string& s) {
  size_t a = 0;
  while (a < s.size() && std::isspace((unsigned char)s[a])) ++a;
  size_t b = s.size();
  while (b > a && std::isspace((unsigned char)s[b - 1])) --b;
  return s.substr(a, b - a);
}

// Splits a JSON array body into top-level element strings.
std::vector<std::string> SplitTopLevel(const std::string& body) {
  std::vector<std::string> out;
  int depthBrace = 0, depthBracket = 0;
  bool inStr = false, esc = false;
  size_t start = 0;
  for (size_t i = 0; i < body.size(); ++i) {
    const char c = body[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c == '\\') {
        esc = true;
      } else if (c == '"') {
        inStr = false;
      }
      continue;
    }
    if (c == '"') {
      inStr = true;
    } else if (c == '{') {
      ++depthBrace;
    } else if (c == '}') {
      --depthBrace;
    } else if (c == '[') {
      ++depthBracket;
    } else if (c == ']') {
      --depthBracket;
    } else if (c == ',' && depthBrace == 0 && depthBracket == 0) {
      out.push_back(Trim(body.substr(start, i - start)));
      start = i + 1;
    }
  }
  const std::string tail = Trim(body.substr(start));
  if (!tail.empty()) out.push_back(tail);
  return out;
}

std::string Unquote(const std::string& s) {
  const std::string t = Trim(s);
  if (t.size() >= 2 && t.front() == '"' && t.back() == '"') {
    std::string out;
    for (size_t i = 1; i + 1 < t.size(); ++i) {
      if (t[i] == '\\' && i + 1 + 1 < t.size() + 1) {
        ++i;
        out.push_back(t[i]);
      } else {
        out.push_back(t[i]);
      }
    }
    return out;
  }
  return t;
}

double ToDouble(const std::string& s, bool* ok) {
  try {
    size_t pos = 0;
    const double v = std::stod(Trim(s), &pos);
    if (ok) *ok = true;
    return v;
  } catch (...) {
    if (ok) *ok = false;
    return 0.0;
  }
}

}  // namespace

bool ExtractJsonValue(const std::string& json, const std::string& key,
                      std::string* rawOut) {
  const std::string pat = "\"" + key + "\"";
  const size_t pos = json.find(pat);
  if (pos == std::string::npos) return false;
  size_t colon = json.find(':', pos + pat.size());
  if (colon == std::string::npos) return false;
  size_t i = colon + 1;
  while (i < json.size() && std::isspace((unsigned char)json[i])) ++i;
  if (i >= json.size()) return false;
  const char c = json[i];
  if (c == '"') {
    size_t j = i + 1;
    bool esc = false;
    while (j < json.size()) {
      if (esc) {
        esc = false;
      } else if (json[j] == '\\') {
        esc = true;
      } else if (json[j] == '"') {
        break;
      }
      ++j;
    }
    if (j >= json.size()) return false;
    if (rawOut) *rawOut = json.substr(i, j - i + 1);
    return true;
  }
  if (c == '{' || c == '[') {
    const char open = c, close = (c == '{' ? '}' : ']');
    int depth = 0;
    bool inStr = false, esc = false;
    size_t j = i;
    for (; j < json.size(); ++j) {
      const char d = json[j];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (d == '\\') {
          esc = true;
        } else if (d == '"') {
          inStr = false;
        }
        continue;
      }
      if (d == '"') {
        inStr = true;
      } else if (d == open) {
        ++depth;
      } else if (d == close) {
        --depth;
        if (depth == 0) {
          if (rawOut) *rawOut = json.substr(i, j - i + 1);
          return true;
        }
      }
    }
    return false;
  }
  // number / true / false / null
  size_t j = i;
  while (j < json.size() && json[j] != ',' && json[j] != '}' &&
         json[j] != ']') {
    ++j;
  }
  if (rawOut) *rawOut = Trim(json.substr(i, j - i));
  return true;
}

bool ConstraintKindFromString(const std::string& s,
                              SketchConstraintKind* out) {
  if (s == "coincident") *out = SketchConstraintKind::Coincident;
  else if (s == "horizontal") *out = SketchConstraintKind::Horizontal;
  else if (s == "vertical") *out = SketchConstraintKind::Vertical;
  else if (s == "parallel") *out = SketchConstraintKind::Parallel;
  else if (s == "perpendicular") *out = SketchConstraintKind::Perpendicular;
  else if (s == "equalRadius") *out = SketchConstraintKind::EqualRadius;
  else if (s == "concentric") *out = SketchConstraintKind::Concentric;
  else if (s == "distance") *out = SketchConstraintKind::Distance;
  else if (s == "radius") *out = SketchConstraintKind::Radius;
  else if (s == "diameter") *out = SketchConstraintKind::Diameter;
  else if (s == "angle") *out = SketchConstraintKind::Angle;
  else if (s == "pointOnLine") *out = SketchConstraintKind::PointOnLine;
  else if (s == "fixed") *out = SketchConstraintKind::Fixed;
  else return false;
  return true;
}

std::string ConstraintKindToString(SketchConstraintKind kind) {
  switch (kind) {
    case SketchConstraintKind::Coincident: return "coincident";
    case SketchConstraintKind::Horizontal: return "horizontal";
    case SketchConstraintKind::Vertical: return "vertical";
    case SketchConstraintKind::Parallel: return "parallel";
    case SketchConstraintKind::Perpendicular: return "perpendicular";
    case SketchConstraintKind::EqualRadius: return "equalRadius";
    case SketchConstraintKind::Concentric: return "concentric";
    case SketchConstraintKind::Distance: return "distance";
    case SketchConstraintKind::Radius: return "radius";
    case SketchConstraintKind::Diameter: return "diameter";
    case SketchConstraintKind::Angle: return "angle";
    case SketchConstraintKind::PointOnLine: return "pointOnLine";
    case SketchConstraintKind::Fixed: return "fixed";
  }
  return "fixed";
}

namespace {

bool ParseStringArray(const std::string& raw, std::vector<std::string>* out,
                      std::string* error) {
  const std::string t = Trim(raw);
  if (t.empty() || t.front() != '[') {
    if (error) *error = "expected string array";
    return false;
  }
  const std::string body = t.substr(1, t.size() - 2);
  for (const auto& el : SplitTopLevel(body)) {
    out->push_back(Unquote(el));
  }
  return true;
}

bool GetString(const std::string& obj, const std::string& key,
               std::string* out, bool required, std::string* error) {
  std::string raw;
  if (!ExtractJsonValue(obj, key, &raw)) {
    if (required && error) *error = "missing key " + key;
    return !required;
  }
  *out = Unquote(raw);
  return true;
}

bool GetDouble(const std::string& obj, const std::string& key, double* out,
               bool required, std::string* error) {
  std::string raw;
  if (!ExtractJsonValue(obj, key, &raw)) {
    if (required && error) *error = "missing key " + key;
    return !required;
  }
  bool ok = false;
  *out = ToDouble(raw, &ok);
  if (!ok && error) *error = "bad number for " + key;
  return ok;
}

bool GetBool(const std::string& obj, const std::string& key, bool* out) {
  std::string raw;
  if (!ExtractJsonValue(obj, key, &raw)) return false;
  const std::string t = Trim(raw);
  *out = (t == "true" || t == "1");
  return true;
}

}  // namespace

bool ParseSketchModel(const std::string& json, SketchModel* out,
                      std::string* error) {
  const std::string t0 = Trim(json);
  if (t0.size() < 2 || t0.front() != '{' || t0.back() != '}') {
    if (error) *error = "sketch model must be a JSON object";
    return false;
  }
  SketchModel m;
  std::string raw;
  // points
  if (ExtractJsonValue(json, "points", &raw)) {
    const std::string t = Trim(raw);
    if (t.size() < 2 || t.front() != '[') {
      if (error) *error = "points must be an array";
      return false;
    }
    for (const auto& el : SplitTopLevel(t.substr(1, t.size() - 2))) {
      SketchPoint p;
      if (!GetString(el, "id", &p.id, true, error)) return false;
      if (!GetDouble(el, "x", &p.x, true, error)) return false;
      if (!GetDouble(el, "y", &p.y, true, error)) return false;
      GetBool(el, "fixed", &p.fixed);
      m.points.push_back(std::move(p));
    }
  }
  // lines
  if (ExtractJsonValue(json, "lines", &raw)) {
    const std::string t = Trim(raw);
    if (t.size() < 2 || t.front() != '[') {
      if (error) *error = "lines must be an array";
      return false;
    }
    for (const auto& el : SplitTopLevel(t.substr(1, t.size() - 2))) {
      SketchLine l;
      if (!GetString(el, "id", &l.id, true, error)) return false;
      if (!GetString(el, "p1", &l.p1, true, error)) return false;
      if (!GetString(el, "p2", &l.p2, true, error)) return false;
      m.lines.push_back(std::move(l));
    }
  }
  // circles
  if (ExtractJsonValue(json, "circles", &raw)) {
    const std::string t = Trim(raw);
    if (t.size() < 2 || t.front() != '[') {
      if (error) *error = "circles must be an array";
      return false;
    }
    for (const auto& el : SplitTopLevel(t.substr(1, t.size() - 2))) {
      SketchCircle c;
      if (!GetString(el, "id", &c.id, true, error)) return false;
      if (!GetString(el, "center", &c.center, true, error)) return false;
      if (!GetDouble(el, "r", &c.r, true, error)) return false;
      m.circles.push_back(std::move(c));
    }
  }
  // arcs
  if (ExtractJsonValue(json, "arcs", &raw)) {
    const std::string t = Trim(raw);
    if (t.size() < 2 || t.front() != '[') {
      if (error) *error = "arcs must be an array";
      return false;
    }
    for (const auto& el : SplitTopLevel(t.substr(1, t.size() - 2))) {
      SketchArc a;
      if (!GetString(el, "id", &a.id, true, error)) return false;
      if (!GetString(el, "center", &a.center, true, error)) return false;
      if (!GetDouble(el, "r", &a.r, true, error)) return false;
      GetDouble(el, "startAngleRad", &a.startAngleRad, false, nullptr);
      GetDouble(el, "endAngleRad", &a.endAngleRad, false, nullptr);
      // Also accept degrees from sloppy clients? No — canonical rad only.
      m.arcs.push_back(std::move(a));
    }
  }
  // constraints
  if (ExtractJsonValue(json, "constraints", &raw)) {
    const std::string t = Trim(raw);
    if (t.size() < 2 || t.front() != '[') {
      if (error) *error = "constraints must be an array";
      return false;
    }
    for (const auto& el : SplitTopLevel(t.substr(1, t.size() - 2))) {
      SketchConstraint c;
      if (!GetString(el, "id", &c.id, true, error)) return false;
      std::string kind;
      if (!GetString(el, "kind", &kind, true, error)) return false;
      if (!ConstraintKindFromString(kind, &c.kind)) {
        if (error) *error = "unknown constraint kind " + kind;
        return false;
      }
      std::string refsRaw;
      if (ExtractJsonValue(el, "refs", &refsRaw)) {
        if (!ParseStringArray(refsRaw, &c.refs, error)) return false;
      }
      GetDouble(el, "value", &c.value, false, nullptr);
      m.constraints.push_back(std::move(c));
    }
  }
  *out = std::move(m);
  return true;
}

namespace {

std::string Esc(const std::string& s) {
  std::string out;
  for (char c : s) {
    if (c == '"' || c == '\\') out.push_back('\\');
    out.push_back(c);
  }
  return out;
}

}  // namespace

std::string SerializeSketchModel(const SketchModel& model) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"points\":[";
  for (size_t i = 0; i < model.points.size(); ++i) {
    const auto& p = model.points[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(p.id) << "\",\"x\":" << p.x << ",\"y\":" << p.y
       << ",\"fixed\":" << (p.fixed ? "true" : "false") << "}";
  }
  os << "],\"lines\":[";
  for (size_t i = 0; i < model.lines.size(); ++i) {
    const auto& l = model.lines[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(l.id) << "\",\"p1\":\"" << Esc(l.p1)
       << "\",\"p2\":\"" << Esc(l.p2) << "\"}";
  }
  os << "],\"circles\":[";
  for (size_t i = 0; i < model.circles.size(); ++i) {
    const auto& c = model.circles[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(c.id) << "\",\"center\":\"" << Esc(c.center)
       << "\",\"r\":" << c.r << "}";
  }
  os << "],\"arcs\":[";
  for (size_t i = 0; i < model.arcs.size(); ++i) {
    const auto& a = model.arcs[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(a.id) << "\",\"center\":\"" << Esc(a.center)
       << "\",\"r\":" << a.r << ",\"startAngleRad\":" << a.startAngleRad
       << ",\"endAngleRad\":" << a.endAngleRad << "}";
  }
  os << "],\"constraints\":[";
  for (size_t i = 0; i < model.constraints.size(); ++i) {
    const auto& c = model.constraints[i];
    if (i) os << ",";
    os << "{\"id\":\"" << Esc(c.id) << "\",\"kind\":\""
       << ConstraintKindToString(c.kind) << "\",\"refs\":[";
    for (size_t k = 0; k < c.refs.size(); ++k) {
      if (k) os << ",";
      os << "\"" << Esc(c.refs[k]) << "\"";
    }
    os << "],\"value\":" << c.value << "}";
  }
  os << "]}";
  return os.str();
}

std::string SerializeSketchFeature(const SketchFeature& sketch) {
  std::ostringstream os;
  os << std::setprecision(17);
  os << "{\"id\":\"" << Esc(sketch.id) << "\",\"planeKind\":\""
     << Esc(sketch.planeKind) << "\",\"plane\":{\"origin\":["
     << sketch.plane.origin[0] << "," << sketch.plane.origin[1] << ","
     << sketch.plane.origin[2] << "],\"xAxis\":[" << sketch.plane.xAxis[0]
     << "," << sketch.plane.xAxis[1] << "," << sketch.plane.xAxis[2]
     << "],\"yAxis\":[" << sketch.plane.yAxis[0] << ","
     << sketch.plane.yAxis[1] << "," << sketch.plane.yAxis[2]
     << "],\"normal\":[" << sketch.plane.normal[0] << ","
     << sketch.plane.normal[1] << "," << sketch.plane.normal[2] << "]}"
     << ",\"supportRef\":\"" << Esc(sketch.supportRef) << "\",\"model\":"
     << SerializeSketchModel(sketch.model) << "}";
  return os.str();
}

bool ParseSketchFeature(const std::string& json, SketchFeature* out,
                        std::string* error) {
  SketchFeature s;
  std::string raw;
  if (!GetString(json, "id", &s.id, false, nullptr)) {
    if (!ExtractJsonValue(json, "featureId", &raw)) {
      if (error) *error = "sketch id/featureId required";
      return false;
    }
    s.id = Unquote(raw);
  }
  if (ExtractJsonValue(json, "planeKind", &raw)) {
    s.planeKind = Unquote(raw);
  } else {
    s.planeKind = "XY";
  }
  if (s.planeKind != "XY" && s.planeKind != "XZ" && s.planeKind != "YZ") {
    if (error) *error = "planeKind must be XY|XZ|YZ";
    return false;
  }
  s.plane = PrincipalPlane(s.planeKind);
  if (ExtractJsonValue(json, "supportRef", &raw)) {
    s.supportRef = Unquote(raw);
  }
  std::string modelRaw;
  if (ExtractJsonValue(json, "model", &modelRaw)) {
    if (!ParseSketchModel(modelRaw, &s.model, error)) return false;
  } else {
    // Flat form: points/lines/... at top level (UI sends model inline).
    if (!ParseSketchModel(json, &s.model, error)) return false;
  }
  *out = std::move(s);
  return true;
}

}  // namespace kreoda
