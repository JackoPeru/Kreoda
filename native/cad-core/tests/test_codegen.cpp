// Phase 8 flatc parity (C++ side): generated CommandType values must match
// the dispatcher's CommandId, and a CreateBox envelope must round-trip.
// Transport stays JSON until the migration slice — this guards the schema.

#include <gtest/gtest.h>

#include "protocol/dispatcher.h"

#ifdef INTENTCAD_WITH_FLATBUFFERS
#include <flatbuffers/flatbuffers.h>

#include "protocol/generated/cad_protocol_generated.h"

namespace {
using namespace IntentCad::Protocol;
}

// Compile-time parity: .fbs CommandType vs dispatcher CommandId (§65).
static_assert(CommandType_GetCoreInfo == intentcad::kGetCoreInfo, "codegen drift");
static_assert(CommandType_CreateDocument == intentcad::kCreateDocument, "codegen drift");
static_assert(CommandType_CreateBox == intentcad::kCreateBox, "codegen drift");
static_assert(CommandType_CreateCylinder == intentcad::kCreateCylinder, "codegen drift");
static_assert(CommandType_CreateSphere == intentcad::kCreateSphere, "codegen drift");
static_assert(CommandType_SetFeatureParameter == intentcad::kSetFeatureParameter, "codegen drift");
static_assert(CommandType_DeleteFeature == intentcad::kDeleteFeature, "codegen drift");
static_assert(CommandType_Undo == intentcad::kUndo, "codegen drift");
static_assert(CommandType_Redo == intentcad::kRedo, "codegen drift");
static_assert(CommandType_SaveDocument == intentcad::kSaveDocument, "codegen drift");
static_assert(CommandType_OpenDocument == intentcad::kOpenDocument, "codegen drift");
static_assert(CommandType_RequestMesh == intentcad::kRequestMesh, "codegen drift");
static_assert(CommandType_CreateSketch == intentcad::kCreateSketch, "codegen drift");
static_assert(CommandType_UpdateSketch == intentcad::kUpdateSketch, "codegen drift");
static_assert(CommandType_CreateExtrude == intentcad::kCreateExtrude, "codegen drift");
static_assert(CommandType_CreateRevolve == intentcad::kCreateRevolve, "codegen drift");
static_assert(CommandType_RequestSketch == intentcad::kRequestSketch, "codegen drift");
static_assert(CommandType_PreviewSketch == intentcad::kPreviewSketch, "codegen drift");
static_assert(CommandType_CreateBoolean == intentcad::kCreateBoolean, "codegen drift");
static_assert(CommandType_CreateHole == intentcad::kCreateHole, "codegen drift");
static_assert(CommandType_CreateFillet == intentcad::kCreateFillet, "codegen drift");
static_assert(CommandType_CreateChamfer == intentcad::kCreateChamfer, "codegen drift");
static_assert(CommandType_RequestFaceInfo == intentcad::kRequestFaceInfo, "codegen drift");

TEST(Codegen, CreateBoxEnvelopeRoundTrips) {
  flatbuffers::FlatBufferBuilder fbb(256);
  const auto feat = fbb.CreateString("feat-123");
  const auto box =
      CreateCreateBoxCommand(fbb, feat, 100.0, 60.0, 10.0);
  const auto req = fbb.CreateString("req-1");
  const auto doc = fbb.CreateString("doc-1");
  const auto env = CreateCommandEnvelope(fbb, 1, req, doc,
                                         CommandType_CreateBox,
                                         CommandPayload_CreateBoxCommand,
                                         box.Union());
  FinishCommandEnvelopeBuffer(fbb, env);

  const auto* back = GetCommandEnvelope(fbb.GetBufferPointer());
  ASSERT_NE(back, nullptr);
  EXPECT_EQ(back->protocol_version(), 1u);
  EXPECT_EQ(back->type(), CommandType_CreateBox);
  EXPECT_EQ(back->payload_type(), CommandPayload_CreateBoxCommand);
  ASSERT_NE(back->request_id(), nullptr);
  EXPECT_STREQ(back->request_id()->c_str(), "req-1");
  const auto* payload = back->payload_as_CreateBoxCommand();
  ASSERT_NE(payload, nullptr);
  ASSERT_NE(payload->feature_id(), nullptr);
  EXPECT_STREQ(payload->feature_id()->c_str(), "feat-123");
  EXPECT_DOUBLE_EQ(payload->width_mm(), 100.0);
  EXPECT_DOUBLE_EQ(payload->height_mm(), 60.0);
  EXPECT_DOUBLE_EQ(payload->depth_mm(), 10.0);
}

#else

TEST(Codegen, FlatBuffersUnavailable) {
  GTEST_SKIP() << "flatbuffers not found — codegen parity unchecked";
}

#endif
