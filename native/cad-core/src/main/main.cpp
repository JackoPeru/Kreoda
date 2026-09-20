// intentcad-core — native sidecar entry (§7).
// Owns the canonical feature graph/B-Rep/transactions/persistence (§9).
// C++17, RAII, one serialized mutation queue per document (§40).
// stdout = framed IPC ONLY. Logs/diagnostics -> stderr (§50).

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

#include "diagnostics/log.h"
#include "document/document_store.h"
#include "protocol/dispatcher.h"
#include "protocol/framing.h"

#include <Message.hxx>
#include <Message_Messenger.hxx>

#if INTENTCAD_WITH_FLATBUFFERS
#include <flatbuffers/flatbuffers.h>

#include "protocol/generated/cad_protocol_generated.h"
#endif

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {

inline std::string asText(const std::vector<uint8_t>& bytes) {
  return std::string(bytes.begin(), bytes.end());
}

int RunSelfTest() {
  // Numeric extraction: kernel volumes print at full precision (BRepGProp
  // floating point, e.g. 99999.99999999997), so substring matching on exact
  // decimals is wrong — compare with tolerance instead.
  const auto volumeOf = [](const std::string& response) {
    const std::string key = "\"volumeMm3\":";
    const size_t pos = response.find(key);
    if (pos == std::string::npos) return -1.0;
    try {
      return std::stod(response.substr(pos + key.size()));
    } catch (...) {
      return -1.0;
    }
  };
  const auto near = [](double got, double want) {
    return std::fabs(got - want) <= 1.0;
  };
  // Phase 0 acceptance: dispatcher handles the foundation loop without IPC.
  const std::string ping =
      R"({"protocolVersion":1,"requestId":"selftest-1","documentId":"","type":1})";
  const std::string r1 = asText(intentcad::handle_command(ping));
  if (r1.find("\"status\":\"ok\"") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: GetCoreInfo: %s\n", r1.c_str());
    return 1;
  }
  const std::string mk =
      R"({"protocolVersion":1,"requestId":"selftest-2","documentId":"d1","type":2})";
  const std::string r2 = asText(intentcad::handle_command(mk));
  if (r2.find("\"status\":\"ok\"") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: CreateDocument: %s\n", r2.c_str());
    return 1;
  }
  const std::string box =
      R"({"protocolVersion":1,"requestId":"selftest-3","documentId":"d1","type":3,"featureId":"box-1","widthMm":100,"heightMm":50,"depthMm":20})";
  const std::string r3 = asText(intentcad::handle_command(box));
  if (r3.find("\"status\":\"ok\"") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: CreateBox: %s\n", r3.c_str());
    return 1;
  }
  if (!near(volumeOf(r3), 100000.0)) {  // volume 100*50*20
    std::fprintf(stderr, "self-test FAIL: box volume: %s\n", r3.c_str());
    return 1;
  }
  // Cylinder + sphere register through the same validated path.
  const std::string cyl =
      R"({"protocolVersion":1,"requestId":"selftest-4","documentId":"d1","type":4,"featureId":"cyl-1","radiusMm":10,"heightMm":40})";
  if (asText(intentcad::handle_command(cyl)).find("\"status\":\"ok\"") ==
      std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: CreateCylinder\n");
    return 1;
  }
  const std::string sph =
      R"({"protocolVersion":1,"requestId":"selftest-5","documentId":"d1","type":5,"featureId":"sph-1","radiusMm":15})";
  if (asText(intentcad::handle_command(sph)).find("\"status\":\"ok\"") ==
      std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: CreateSphere\n");
    return 1;
  }
  // Box mesh: 12 triangles with persistent role ids (§8: FlatBuffers).
  const std::string mesh =
      R"({"protocolVersion":1,"requestId":"selftest-6","documentId":"d1","type":12,"featureId":"box-1","lod":1})";
#if INTENTCAD_WITH_FLATBUFFERS
  const std::vector<uint8_t> r6 = intentcad::handle_command(mesh);
  {
    flatbuffers::Verifier verifier(r6.data(), r6.size());
    const auto* update =
        flatbuffers::GetRoot<IntentCad::Protocol::MeshUpdate>(r6.data());
    auto fail = [&](const char* what) {
      std::fprintf(stderr, "self-test FAIL: RequestMesh box (%s)\n", what);
      return 1;
    };
    if (update == nullptr) return fail("null root");
    if (!update->Verify(verifier)) return fail("verify");
    if (update->indices_count() / 3 != 12) return fail("triangles");
    if (update->faces() == nullptr || update->faces()->size() < 2)
      return fail("faces");
    bool topFound = false;
    for (flatbuffers::uoffset_t i = 0; i < update->faces()->size(); ++i) {
      const auto* f = update->faces()->Get(i);
      if (f && f->persistent_face_id() &&
          f->persistent_face_id()->str() == "box-1:box.+Z") {
        topFound = true;
      }
    }
    if (!topFound) return fail("role");
    // C15: the table echoes the request id for sidecar correlation.
    if (update->request_id() == nullptr ||
        update->request_id()->str() != "selftest-6")
      return fail("request_id");
  }
#else
  const std::string r6 = asText(intentcad::handle_command(mesh));
  if (r6.find("\"status\":\"error\"") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: mesh without flatbuffers: %s\n",
                 r6.c_str());
    return 1;
  }
#endif
  // Unknown feature must fail honestly, never with a fake mesh (§41).
  const std::string bad =
      R"({"protocolVersion":1,"requestId":"selftest-7","documentId":"d1","type":12,"featureId":"nope","lod":1})";
  if (asText(intentcad::handle_command(bad)).find("\"status\":\"error\"") ==
      std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: unknown mesh should error\n");
    return 1;
  }
  // Typed dimension edit: one commit, exact new volume (Phase 2).
  const std::string setp =
      R"({"protocolVersion":1,"requestId":"selftest-8","documentId":"d1","type":6,"featureId":"box-1","paramName":"widthMm","valueMm":150})";
  const std::string r8 = asText(intentcad::handle_command(setp));
#if INTENTCAD_WITH_OCCT
  if (r8.find("\"status\":\"ok\"") == std::string::npos ||
      !near(volumeOf(r8), 150000.0)) {
    std::fprintf(stderr, "self-test FAIL: SetFeatureParameter: %s\n",
                 r8.c_str());
    return 1;
  }
#else
  // Stub core: rebuild honestly requires OCCT (§0.8 — useful without AI/OCCT
  // for UI work, but no B-Rep recompute).
  if (r8.find("requires OCCT") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: stub rebuild must say OCCT: %s\n",
                 r8.c_str());
    return 1;
  }
#endif
#if INTENTCAD_WITH_OCCT && INTENTCAD_WITH_PLANEGCS
  // Phase 4: sketch (100x50 rect) → extrude 20 → exact 100000 volume.
  const std::string sk =
      R"({"protocolVersion":1,"requestId":"selftest-9","documentId":"d1","type":13,"featureId":"sk-1","planeKind":"XY","model":{"points":[{"id":"p0","x":0,"y":0},{"id":"p1","x":100,"y":0},{"id":"p2","x":100,"y":50},{"id":"p3","x":0,"y":50}],"lines":[{"id":"l0","p1":"p0","p2":"p1"},{"id":"l1","p1":"p1","p2":"p2"},{"id":"l2","p1":"p2","p2":"p3"},{"id":"l3","p1":"p3","p2":"p0"}],"constraints":[{"id":"h0","kind":"horizontal","refs":["l0"]},{"id":"h2","kind":"horizontal","refs":["l2"]},{"id":"v1","kind":"vertical","refs":["l1"]},{"id":"v3","kind":"vertical","refs":["l3"]},{"id":"w","kind":"distance","refs":["p0","p1"],"value":100},{"id":"h","kind":"distance","refs":["p1","p2"],"value":50}]}})";
  const std::string r9 = asText(intentcad::handle_command(sk));
  if (r9.find("\"status\":\"ok\"") == std::string::npos) {
    std::fprintf(stderr, "self-test FAIL: CreateSketch: %s\n", r9.c_str());
    return 1;
  }
  const std::string ex =
      R"({"protocolVersion":1,"requestId":"selftest-10","documentId":"d1","type":15,"featureId":"ex-1","sketchId":"sk-1","distanceMm":20})";
  const std::string r10 = asText(intentcad::handle_command(ex));
  if (r10.find("\"status\":\"ok\"") == std::string::npos ||
      !near(volumeOf(r10), 100000.0)) {
    std::fprintf(stderr, "self-test FAIL: CreateExtrude: %s\n", r10.c_str());
    return 1;
  }
#endif
  // Persistence round-trip is covered by tests/test_persistence.cpp (needs
  // OCCT + minizip, i.e. the vcpkg build) rather than fixed paths here.
  std::printf("intentcad-core self-test OK\n");
  return 0;
}

void WriteAll(const std::vector<uint8_t>& bytes) {
  std::cout.write(reinterpret_cast<const char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
  std::cout.flush();
}

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
  // Binary framed IPC over stdio (§8): disable CRT \r\n / 0x1A translation,
  // otherwise length prefixes and payloads get mangled on Windows.
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--self-test") return RunSelfTest();
    if (a == "--version") {
      std::printf("intentcad-core 0.1.0 protocol=1 occt=%s\n",
#if INTENTCAD_WITH_OCCT
                  "8.0.1"
#else
                  "stub"
#endif
      );
      return 0;
    }
  }

  intentcad::DocumentStore::instance().create("doc-bootstrap");
  // stdout is framed IPC ONLY (C12): detach every OCCT default-messenger
  // printer once, so no component (transfer stats, healing, meshing) can
  // ever interleave text into the byte stream. Our own LogCore writes to
  // stderr directly and is unaffected. Exchange calls keep their local
  // ScopedMute as defense in depth.
  intentcad::protocol::FrameDecoder decoder;
  Message::DefaultMessenger()->ChangePrinters().Clear();
  LogCore("sidecar ready (protocol=1)");

  // NOTE: std::istream::read(n) blocks until n bytes arrive — unusable for a
  // framed pipe server. Read byte-by-byte (requests are small; bulk mesh data
  // flows core→renderer, not the reverse) and dispatch complete frames.
  std::vector<uint8_t> one(1);
  int ch = 0;
  while ((ch = std::cin.get()) != EOF) {
    one[0] = static_cast<uint8_t>(ch);
    decoder.push(one.data(), 1);
    std::vector<std::vector<uint8_t>> frames;
    try {
      frames = decoder.pop();
    } catch (const std::exception& e) {
      // M14: one corrupt/oversized frame must not kill the sidecar —
      // report, reset the stream, keep serving.
      LogCore(std::string("frame error, resetting decoder: ") + e.what());
      decoder = intentcad::protocol::FrameDecoder();
      continue;
    }
    for (auto& payload : frames) {
      const auto t0 = std::chrono::steady_clock::now();
      const std::string req(payload.begin(), payload.end());
      // §63.10: version check before dispatch.
      const int v = intentcad::json_int_field(req, "protocolVersion", -1);
      std::vector<uint8_t> resp;
      if (v != 1) {
        const std::string rid =
            intentcad::json_string_field(req, "requestId", "");
        resp = intentcad::make_response(
            rid, "error",
            "\"errorCode\":\"BAD_PROTOCOL\",\"errorMessage\":\"expected "
            "protocolVersion 1\"");
      } else {
        resp = intentcad::handle_command(req);
      }
      const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::steady_clock::now() - t0)
                          .count();
      LogCore("op requestId=" +
              intentcad::json_string_field(req, "requestId", "?") +
              " durationMs=" + std::to_string(ms));
      WriteAll(intentcad::protocol::frame(resp));
    }
  }
  LogCore("stdin closed, exiting");
  return 0;
}
