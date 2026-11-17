import { describe, expect, it } from "vitest";
import contract from "../../../schemas/session-control-v1.json" with { type: "json" };
import {
  CancelVoiceParamsSchema,
  CancelVoicePayloadSchema,
  ErrorReplySchema,
  GetVoiceStatusParamsSchema,
  GetVoiceStatusPayloadSchema,
  SynthesizeVoiceParamsSchema,
  SynthesizeVoicePayloadSchema,
  TranscribeVoiceParamsSchema,
  TranscribeVoicePayloadSchema,
  VoiceTurnAgentReplySchema,
  VoiceTurnParamsSchema,
  VoiceTurnPayloadSchema,
  CONTROL_METHODS,
  OPERATION_METHODS,
  SESSION_CONTROL_METHODS,
  SESSION_SERVER_CAPABILITIES,
  SessionRecoveryIdentitySchema,
} from "./session-control.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const DOCUMENT = "doc-phase-voice";
const VOICE_METHODS = ["getVoiceStatus", "transcribeVoice", "voiceTurn", "synthesizeVoice", "cancelVoice"];
const context = (extra: Record<string, unknown> = {}) => ({
  voiceRequestId: REQUEST,
  sessionId: SESSION,
  documentId: DOCUMENT,
  revision: 7,
  ...extra,
});

describe("voice-v1 session contract", () => {
  it("classifies five methods as non-replay control methods and advertises capability", () => {
    const methods = (contract.methods as { method: string; plane: string; operationReplay: boolean }[])
      .filter(method => VOICE_METHODS.includes(method.method));
    expect(methods.map(method => method.method)).toEqual(VOICE_METHODS);
    expect(methods.every(method => method.plane === "control" && method.operationReplay === false)).toBe(true);
    expect([...CONTROL_METHODS]).toEqual(expect.arrayContaining(VOICE_METHODS));
    expect([...SESSION_CONTROL_METHODS]).toEqual(expect.arrayContaining(VOICE_METHODS));
    expect([...OPERATION_METHODS]).not.toEqual(expect.arrayContaining(VOICE_METHODS));
    expect(SESSION_SERVER_CAPABILITIES).toContain("voice-v1");
  });

  it("validates strict request DTOs, canonical base64 shape, and bounded UTF-8 context", () => {
    expect(GetVoiceStatusParamsSchema.safeParse({}).success).toBe(true);
    expect(GetVoiceStatusParamsSchema.safeParse({ extra: true }).success).toBe(false);
    expect(TranscribeVoiceParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, wavBase64: Buffer.alloc(44).toString("base64"),
    }).success).toBe(true);
    for (const wavBase64 of ["AA A", "AAAA ", "AAAA=", "-___"]) {
      expect(TranscribeVoiceParamsSchema.safeParse({
        voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, wavBase64,
      }).success).toBe(false);
    }
    expect(TranscribeVoiceParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: -1, wavBase64: "AAAA",
    }).success).toBe(false);
    expect(TranscribeVoiceParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, wavBase64: "AAAA", extra: true,
    }).success).toBe(false);

    expect(VoiceTurnParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, text: "Crea un box", context: context({ extra: "preserved" }),
    }).success).toBe(true);
    expect(VoiceTurnParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, text: "Crea un box",
      context: context({ extra: "é".repeat(33000) }),
    }).success).toBe(false);
    expect(VoiceTurnParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, text: " ", context: context(),
    }).success).toBe(false);
    expect(VoiceTurnParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, text: "x".repeat(8001), context: context(),
    }).success).toBe(false);
    expect(SynthesizeVoiceParamsSchema.safeParse({
      voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7, text: "Pronto",
    }).success).toBe(true);
    expect(CancelVoiceParamsSchema.safeParse({ voiceRequestId: REQUEST, documentId: DOCUMENT }).success).toBe(true);
    expect(CancelVoiceParamsSchema.safeParse({ voiceRequestId: REQUEST, documentId: DOCUMENT, expectedRevision: 7 }).success).toBe(false);
  });

  it("validates strict CAD result envelopes and Hermes reply identity separately", () => {
    expect(GetVoiceStatusPayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, configured: true, reachable: false,
    }).success).toBe(true);
    expect(GetVoiceStatusPayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, configured: true, reachable: false, token: "secret",
    }).success).toBe(false);
    expect(TranscribeVoicePayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, voiceRequestId: REQUEST, text: "Dettato",
    }).success).toBe(true);
    const agentReply = { text: "Pronto", sessionId: "hermes-conversation", runId: "run_1.x-2" };
    expect(VoiceTurnAgentReplySchema.safeParse(agentReply).success).toBe(true);
    expect(VoiceTurnAgentReplySchema.safeParse({ ...agentReply, runId: "bad run id" }).success).toBe(false);
    expect(VoiceTurnPayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 8, voiceRequestId: REQUEST, reply: agentReply,
    }).success).toBe(true);
    expect(SynthesizeVoicePayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, voiceRequestId: REQUEST, wavBase64: "AAAA",
    }).success).toBe(true);
    expect(CancelVoicePayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, voiceRequestId: REQUEST, status: "cancelRequested",
    }).success).toBe(true);
    expect(CancelVoicePayloadSchema.safeParse({
      sessionId: SESSION, documentId: DOCUMENT, revision: 7, voiceRequestId: REQUEST, status: "cancelled",
    }).success).toBe(false);
  });

  it("keeps uncertain rollback recovery typed and bounded in error replies", () => {
    const recovery = {
      requestId: REQUEST, transactionId: "33333333-3333-4333-8333-333333333333", sessionId: SESSION,
      documentId: DOCUMENT, baseRevision: 7, ownerClientId: "client-44444444-4444-4444-8444-444444444444",
      causeCode: "NEED_FULL_SNAPSHOT",
    };
    expect(SessionRecoveryIdentitySchema.safeParse(recovery).success).toBe(true);
    expect(SessionRecoveryIdentitySchema.safeParse({ ...recovery, secret: "must reject" }).success).toBe(false);
    expect(SessionRecoveryIdentitySchema.safeParse({ ...recovery, documentId: "x".repeat(513) }).success).toBe(false);
    expect(ErrorReplySchema.safeParse({ requestId: "voice-error", ok: false, errorCode: "ROLLBACK_UNCONFIRMED",
      error: "Rollback remains uncertain", status: "uncertain", recovery, recoveryPersisted: true }).success).toBe(true);
  });
});
