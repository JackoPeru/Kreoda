import { SessionRecoveryIdentitySchema } from "@kreoda/protocol";
import type { SessionRecoveryIdentity } from "@kreoda/protocol";

const BRIDGE = "http://127.0.0.1:9843";
const MAX_ERROR_BYTES = 65536;
const MAX_TURN_BYTES = 65536;
const MAX_STT_BYTES = 1024 * 1024;
const MAX_TTS_BYTES = 4 * 1024 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_STAGE = /^[A-Za-z0-9_.-]{1,32}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export interface SessionVoiceOptions {
  /** Private Desktop-to-Bridge credential. Never supplied by a peer. */
  token?: string;
  /** Test seam; production always uses the fixed loopback endpoints below. */
  fetch?: typeof globalThis.fetch;
}

export class SessionVoiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stage?: string,
    readonly runId?: string,
    readonly status?: "uncertain",
    readonly recovery?: SessionRecoveryIdentity,
    readonly recoveryPersisted?: boolean,
  ) {
    super(message);
    this.name = "SessionVoiceError";
  }
}

function badParams(message: string): SessionVoiceError {
  return new SessionVoiceError(message, "BAD_PARAMS");
}

function validToken(token: string | undefined): token is string {
  return typeof token === "string" && token.length >= 16 && /^[\x21-\x7e]+$/.test(token);
}

function failureMessage(value: unknown, token: string | undefined): string {
  if (typeof value !== "string") return "Voice bridge request failed";
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(token ? new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /$^/, "[redacted]")
    .trim().slice(0, 512);
  return cleaned || "Voice bridge request failed";
}

function parseJson(bytes: Uint8Array, stage: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new SessionVoiceError("Voice bridge returned invalid JSON", "VOICE_FAILED", stage); }
}

function validateWav(bytes: Uint8Array, maxSeconds: number): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE" ||
      data.readUInt32LE(4) !== data.length - 8)
    throw badParams("Invalid WAV container");
  let offset = 12, chunks = 0, format: { code: number; channels: number; rate: number; byteRate: number; align: number; bits: number } | null = null;
  let dataBytes = -1;
  while (offset < data.length) {
    if (++chunks > 64 || offset + 8 > data.length) throw badParams("Invalid WAV chunks");
    const id = data.toString("ascii", offset, offset + 4), size = data.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size, paddedEnd = end + (size & 1);
    if (end > data.length || paddedEnd > data.length) throw badParams("Invalid WAV chunk length");
    if (id === "fmt ") {
      if (format || size < 16) throw badParams("Invalid WAV format chunk");
      format = { code: data.readUInt16LE(start), channels: data.readUInt16LE(start + 2), rate: data.readUInt32LE(start + 4),
        byteRate: data.readUInt32LE(start + 8), align: data.readUInt16LE(start + 12), bits: data.readUInt16LE(start + 14) };
    } else if (id === "data") {
      if (dataBytes >= 0) throw badParams("Invalid WAV data chunks");
      dataBytes = size;
    }
    offset = paddedEnd;
  }
  if (!format || dataBytes <= 0 || offset !== data.length) throw badParams("WAV format or audio data missing");
  const bytesPerSample = format.code === 1 && format.bits === 16 ? 2 : format.code === 3 && format.bits === 32 ? 4 : 0;
  if (!bytesPerSample || format.channels < 1 || format.channels > 2 || format.rate < 8000 || format.rate > 96000 ||
      format.align !== format.channels * bytesPerSample || format.byteRate !== format.rate * format.align ||
      dataBytes % format.align !== 0 || dataBytes / format.byteRate > maxSeconds)
    throw badParams("WAV encoding or duration is outside supported limits");
}

function decodeWavBase64(value: string, maxBytes: number, maxSeconds: number): Buffer {
  const maxChars = Math.ceil(maxBytes / 3) * 4;
  if (typeof value !== "string" || value.length < 4 || value.length > maxChars || !BASE64.test(value))
    throw badParams("Invalid or oversized base64 WAV");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes || bytes.toString("base64") !== value) throw badParams("Invalid or oversized base64 WAV");
  validateWav(bytes, maxSeconds);
  return bytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export class SessionVoiceBridge {
  private readonly token?: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: SessionVoiceOptions = {}) {
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  get configured(): boolean { return validToken(this.token); }

  async reachable(signal?: AbortSignal): Promise<boolean> {
    try {
      const bytes = await this.request("/health", "GET", undefined, MAX_ERROR_BYTES, 3000, "health", signal, false);
      const health = asRecord(parseJson(bytes, "health"));
      return health?.["service"] === "kreoda-hermes-bridge" && health["mcp"] === true;
    } catch (error) {
      if (signal?.aborted) throw error;
      return false;
    }
  }

  async transcribe(wavBase64: string, signal?: AbortSignal): Promise<string> {
    this.requireConfigured();
    const wav = decodeWavBase64(wavBase64, MAX_STT_BYTES, 30);
    const bytes = await this.request("/voice/transcribe", "POST", wav, MAX_ERROR_BYTES, 65000, "transcribe", signal);
    const result = asRecord(parseJson(bytes, "transcribe"));
    if (!result || typeof result["text"] !== "string" || result["text"].length > 8000)
      throw new SessionVoiceError("Voice bridge returned invalid transcription", "VOICE_FAILED", "transcribe");
    return result["text"];
  }

  async turn(text: string, context: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    this.requireConfigured();
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 8000 ||
        !context || typeof context !== "object" || Array.isArray(context) ||
        Buffer.byteLength(JSON.stringify(context), "utf8") > MAX_ERROR_BYTES)
      throw badParams("Invalid voice turn request");
    const body = JSON.stringify({ text, context });
    if (Buffer.byteLength(body, "utf8") > MAX_TURN_BYTES) throw badParams("Voice turn exceeds Bridge request limit");
    const bytes = await this.request("/voice/turn", "POST", body, MAX_ERROR_BYTES, 185000, "turn", signal);
    const reply = asRecord(parseJson(bytes, "turn"));
    if (!reply || typeof reply["text"] !== "string" || reply["text"].length > 8000 ||
        typeof reply["runId"] !== "string" || !SAFE_RUN_ID.test(reply["runId"]) ||
        (reply["sessionId"] !== undefined && reply["sessionId"] !== null &&
          (typeof reply["sessionId"] !== "string" || reply["sessionId"].length > 256)))
      throw new SessionVoiceError("Voice bridge returned invalid turn identity", "VOICE_FAILED", "turn");
    return reply;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<string> {
    this.requireConfigured();
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 8000) throw badParams("Invalid synthesis text");
    const bytes = await this.request("/voice/speech", "POST", JSON.stringify({ text, context: {} }), MAX_TTS_BYTES,
      65000, "synthesize", signal);
    validateWav(bytes, 120);
    return Buffer.from(bytes).toString("base64");
  }

  private requireConfigured(): void {
    if (!this.configured) throw new SessionVoiceError("Voice is not configured", "VOICE_UNAVAILABLE");
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body: Uint8Array | string | undefined,
    maxBytes: number,
    timeoutMs: number,
    stage: string,
    callerSignal?: AbortSignal,
    authenticated = true,
  ): Promise<Uint8Array> {
    if (authenticated) this.requireConfigured();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const abort = (): void => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    const headers: Record<string, string> = {};
    if (authenticated && this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = body instanceof Uint8Array ? "audio/wav" : "application/json";
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${BRIDGE}${path}`, {
          method, headers, ...(body === undefined ? {} : { body: body as BodyInit }),
          signal: controller.signal, redirect: "manual", cache: "no-store",
        });
      } catch {
        if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
        throw new SessionVoiceError(timedOut ? "Voice request timed out" : "Voice bridge is unavailable", "VOICE_FAILED", stage);
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        throw new SessionVoiceError("Voice bridge redirect rejected", "VOICE_FAILED", stage);
      }
      const bytes = await this.readBounded(response, response.ok ? maxBytes : MAX_ERROR_BYTES, stage, callerSignal, () => timedOut);
      if (!response.ok) throw this.upstreamError(bytes, stage, response.status);
      return bytes;
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
      if (error instanceof SessionVoiceError) throw error;
      throw new SessionVoiceError(timedOut ? "Voice request timed out" : "Voice bridge request failed", "VOICE_FAILED", stage);
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
    }
  }

  private async readBounded(response: Response, maxBytes: number, stage: string, signal: AbortSignal | undefined,
    timedOut: () => boolean): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new SessionVoiceError("Voice bridge response exceeds size limit", "VOICE_FAILED", stage);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (error instanceof SessionVoiceError) throw error;
      throw new SessionVoiceError(timedOut() ? "Voice request timed out" : "Voice bridge response failed", "VOICE_FAILED", stage);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  }

  private upstreamError(bytes: Uint8Array, stage: string, status: number): SessionVoiceError {
    const value = asRecord(parseJson(bytes, stage));
    const upstreamStage = typeof value?.["stage"] === "string" && SAFE_STAGE.test(value["stage"])
      ? value["stage"] : stage;
    const runId = typeof value?.["runId"] === "string" && SAFE_RUN_ID.test(value["runId"])
      ? value["runId"] : undefined;
    const message = failureMessage(value?.["error"], this.token);
    if (value?.["errorCode"] === "ROLLBACK_UNCONFIRMED") {
      const recovery = SessionRecoveryIdentitySchema.safeParse(value["recovery"]);
      return new SessionVoiceError(message, "ROLLBACK_UNCONFIRMED", upstreamStage, runId, "uncertain",
        recovery.success ? recovery.data : undefined,
        typeof value["recoveryPersisted"] === "boolean" ? value["recoveryPersisted"] : undefined);
    }
    const code = stage === "turn" && status === 409 ? "BUSY" : "VOICE_FAILED";
    return new SessionVoiceError(message, code, upstreamStage, runId);
  }
}
