import {
  CancelVoiceParamsSchema,
  CancelVoicePayloadSchema,
  GetVoiceStatusParamsSchema,
  GetVoiceStatusPayloadSchema,
  SessionRecoveryIdentitySchema,
  VoiceTurnParamsSchema,
  VoiceTurnPayloadSchema,
} from "@kreoda/protocol";
import type {
  CancelVoiceParams,
  CancelVoicePayload,
  GetVoiceStatusPayload,
  SessionRecoveryIdentity,
  VoiceTurnParams,
  VoiceTurnPayload,
} from "@kreoda/protocol";
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import type { SessionRelay } from "./session";
import { SessionVoiceError } from "./session-voice";

export type AgentFailureCode =
  | "BAD_PARAMS"
  | "BUSY"
  | "CANCELLED"
  | "CLIENT_DISCONNECTED"
  | "FORBIDDEN"
  | "NEED_FULL_SNAPSHOT"
  | "NOT_IMPLEMENTED"
  | "ROLLBACK_UNCONFIRMED"
  | "SESSION_UNAVAILABLE"
  | "VOICE_FAILED"
  | "VOICE_UNAVAILABLE";

export interface AgentFailure {
  code: AgentFailureCode;
  message: string;
  stage?: string;
  runId?: string;
  status?: "uncertain";
  recovery?: SessionRecoveryIdentity;
  recoveryPersisted?: boolean;
}

export type AgentResult<T> = { ok: true; result: T } | { ok: false; error: AgentFailure };

const FAILURE_MESSAGES: Record<AgentFailureCode, string> = {
  BAD_PARAMS: "Invalid agent request",
  BUSY: "A voice request is already active",
  CANCELLED: "Voice request was cancelled",
  CLIENT_DISCONNECTED: "Desktop renderer changed",
  FORBIDDEN: "Desktop renderer is not authorized",
  NEED_FULL_SNAPSHOT: "CAD context changed; refresh before continuing",
  NOT_IMPLEMENTED: "Hermes agent is unavailable",
  ROLLBACK_UNCONFIRMED: "CAD recovery status is uncertain",
  SESSION_UNAVAILABLE: "Local session is unavailable",
  VOICE_FAILED: "Voice bridge request failed",
  VOICE_UNAVAILABLE: "Hermes is not configured",
};
const SAFE_STAGE = /^[A-Za-z0-9_.-]{1,32}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failureForCode(code: AgentFailureCode): AgentResult<never> {
  return { ok: false, error: { code, message: FAILURE_MESSAGES[code] } };
}

function failureFor(error: unknown): AgentResult<never> {
  const rawCode = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  const code = typeof rawCode === "string" && Object.hasOwn(FAILURE_MESSAGES, rawCode)
    ? rawCode as AgentFailureCode : "VOICE_FAILED";
  const safe: AgentFailure = { code, message: FAILURE_MESSAGES[code] };
  if (error instanceof SessionVoiceError) {
    if (typeof error.stage === "string" && SAFE_STAGE.test(error.stage)) safe.stage = error.stage;
    if (typeof error.runId === "string" && SAFE_RUN_ID.test(error.runId)) safe.runId = error.runId;
    if (code === "ROLLBACK_UNCONFIRMED") {
      if (error.status === "uncertain") safe.status = error.status;
      const recovery = SessionRecoveryIdentitySchema.safeParse(error.recovery);
      if (recovery.success) safe.recovery = recovery.data;
      if (typeof error.recoveryPersisted === "boolean") safe.recoveryPersisted = error.recoveryPersisted;
    }
  }
  return { ok: false, error: safe };
}

function allowedRendererUrl(actual: string, expected: string): boolean {
  try {
    const url = new URL(actual);
    const target = new URL(expected);
    if (target.protocol === "file:") {
      if (url.protocol !== "file:") return false;
      url.hash = "";target.hash = "";
      return url.href === target.href;
    }
    if ((target.protocol !== "http:" && target.protocol !== "https:") || url.username || url.password ||
        target.username || target.password) return false;
    return url.origin === target.origin;
  } catch { return false; }
}

function authorized(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null, rendererUrl: string): boolean {
  try {
    const window = getWindow();
    if (!window || window.isDestroyed()) return false;
    const contents = window.webContents;
    if (!contents || contents.isDestroyed()) return false;
    const mainFrame = contents.mainFrame;
    const senderFrame = event.senderFrame;
    if (!mainFrame || !senderFrame || event.sender !== contents || senderFrame !== mainFrame) return false;
    return allowedRendererUrl(contents.getURL(), rendererUrl) && allowedRendererUrl(senderFrame.url, rendererUrl);
  } catch { return false; }
}

function invalidRequest(): never {
  const error = new Error("Invalid agent request") as Error & { code: string };
  error.code = "BAD_PARAMS";
  throw error;
}

export function installSessionAgentIpc(
  ipc: Pick<IpcMain, "handle">,
  getWindow: () => BrowserWindow | null,
  getRelay: () => SessionRelay | null,
  rendererUrl: string,
): void {
  const execute = async <T>(event: IpcMainInvokeEvent, action: (relay: SessionRelay) => Promise<T>): Promise<AgentResult<T>> => {
    if (!authorized(event, getWindow, rendererUrl)) return failureForCode("FORBIDDEN");
    const relay = getRelay();
    if (!relay) return failureForCode("SESSION_UNAVAILABLE");
    try { return { ok: true, result: await action(relay) }; }
    catch (error) { return failureFor(error); }
  };

  ipc.handle("kreoda:agent-status", (event, ...args: unknown[]) => execute(event, async relay => {
    if (args.length !== 1) invalidRequest();
    if (typeof args[0] !== "string" || !SESSION_ID.test(args[0])) invalidRequest();
    GetVoiceStatusParamsSchema.parse({});
    return GetVoiceStatusPayloadSchema.parse(await relay.localAgentStatus(args[0]));
  }));
  ipc.handle("kreoda:agent-turn", (event, ...args: unknown[]) => execute(event, async relay => {
    if (args.length !== 1) invalidRequest();
    const parsed = VoiceTurnParamsSchema.safeParse(args[0]);
    if (!parsed.success) invalidRequest();
    return VoiceTurnPayloadSchema.parse(await relay.localAgentTurn(parsed.data as VoiceTurnParams));
  }));
  ipc.handle("kreoda:agent-cancel", (event, ...args: unknown[]) => execute(event, async relay => {
    if (args.length !== 2) invalidRequest();
    const sessionId = typeof args[0] === "string" && SESSION_ID.test(args[0]) ? args[0] : null;
    const request = CancelVoiceParamsSchema.safeParse(args[1]);
    if (!sessionId || !request.success) invalidRequest();
    return CancelVoicePayloadSchema.parse(await relay.localAgentCancel(sessionId,
      request.data as CancelVoiceParams));
  }));
}
