import { COMMANDS } from "@kreoda/command-schema";
import type { FaceRange } from "@kreoda/protocol";
import { coreClient } from "../ipc/coreClient";
import { executeCommand } from "../commands/execute";
import {
  isSketchId,
  useDocumentUiStore,
  useSelectionStore,
} from "../stores";
import { viewportSetView, type ViewName } from "../viewport/viewportHandle";
import type { IntentPlan, PlanStep } from "./parse";

// Structured AI context (§28): selection + model summary, never raw meshes.
export interface IntentRequest {
  text: string;
  selection: { kind: string; persistentId: string }[];
  model: {
    bodies: { id: string; type: string; paramsMm: number[]; volumeMm3: number }[];
  };
  units: "mm";
}

export function buildIntentRequest(text: string): IntentRequest {
  const sel = useSelectionStore.getState();
  const store = useDocumentUiStore.getState();
  return {
    text,
    selection: sel.selectedIds.map((id) => {
      const cut = id.indexOf(":");
      let kind = "body";
      if (cut >= 0) {
        kind = id.slice(cut + 1).startsWith("edge.") ? "edge" : "face";
      } else if (store.sketches.some((k) => k.featureId === id)) {
        kind = "sketch";
      }
      return { kind, persistentId: id };
    }),
    model: {
      // Cap context: summaries only, never meshes (§28); 20 bodies max.
      bodies: store.features.slice(0, 20).map((f) => ({
        id: f.featureId,
        type: f.type,
        paramsMm: f.paramsMm.slice(0, 12),
        volumeMm3: f.volumeMm3,
      })),
    },
    units: "mm",
  };
}

export interface IntentModelProvider {
  readonly id: string;
  plan(request: IntentRequest): Promise<IntentPlan>;
}

const ALLOWED_DIM_PARAMS = new Set([
  "widthMm", "heightMm", "depthMm", "radiusMm",
  "distanceMm", "diameterMm", "depthMm",
  // Instance placement (Phase 9d): translations + ZYX euler degrees.
  "txMm", "tyMm", "tzMm", "rxDeg", "ryDeg", "rzDeg",
]);

function finitePositive(v: unknown, max = 100000): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
}

const PLACEMENT_PARAMS = new Set(["txMm", "tyMm", "tzMm"]);
const ANGLE_PARAMS = new Set(["rxDeg", "ryDeg", "rzDeg", "angleDeg"]);

function validSetDimensionValue(paramName: string, v: unknown): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (PLACEMENT_PARAMS.has(paramName)) return v >= -1000000 && v <= 1000000;
  if (ANGLE_PARAMS.has(paramName)) {
    // C3/M2: angles accept 0/negative (placement); revolve angleDeg range
    // is enforced core-side ((0,360]) with an honest error.
    return true;
  }
  return (v as number) > 0 && (v as number) <= 100000;
}

const EXPR_RE = /^[0-9A-Za-z_+*/(). \t-]+$/;
function validExpression(expr: unknown): boolean {
  // Minor: whitespace-only passes the charset but fails core — require trim.
  return (
    typeof expr === "string" &&
    expr.length > 0 &&
    expr.length <= 256 &&
    expr.trim().length > 0 &&
    EXPR_RE.test(expr)
  );
}

/** Validate a plan before anything touches the core (§28, §63.10). */
export function validatePlan(plan: IntentPlan): void {
  if (plan.steps.length === 0) throw new Error("Empty plan.");
  if (plan.steps.length > 12) {
    throw new Error("Plan too long (max 12 steps) — split the request.");
  }
  // Undo/Redo must be single-step (a 12×Undo plan would wipe history).
  if (plan.steps.some((s) => s.command === "Undo" || s.command === "Redo") && plan.steps.length > 1) {
    throw new Error("Plans with Undo/Redo must be single-step.");
  }
  const store = plan.source === "llm" ? useDocumentUiStore.getState() : null;
  for (const step of plan.steps) {
    const params = (step as { params: unknown }).params;
    if (typeof params !== "object" || params === null) {
      throw new Error(`Bad arguments for ${step.command} — try short syntax.`);
    }
    // Local shorthand steps resolve context at execution; still range-check
    // every numeric field present so parser bugs can't reach the core.
    // C3: SetDimension valueMm range depends on paramName (placement allows
    // 0/negative, angles allow any finite) — core owns the final gate.
    if (plan.source === "local") {
      const p = params as Record<string, unknown>;
      for (const k of ["widthMm", "heightMm", "depthMm", "radiusMm", "diameterMm", "distanceMm", "insetMm", "depthMm", "xMm", "yMm"]) {
        if (p[k] !== undefined && p[k] !== null) {
          const isXY = k === "xMm" || k === "yMm";
          // depthMm 0 = throughAll (valid); all other dims must be > 0.
          const isDepth = k === "depthMm";
          const ok = isXY
            ? typeof p[k] === "number" && Number.isFinite(p[k] as number) && Math.abs(p[k] as number) <= 100000
            : isDepth
              ? typeof p[k] === "number" && Number.isFinite(p[k] as number) && (p[k] as number) >= 0 && (p[k] as number) <= 100000
              : finitePositive(p[k]);
          if (!ok) throw new Error(`Bad ${k} in ${step.command} — must be a finite positive dimension ≤ 100000.`);
        }
      }
      if (step.command === "SetDimension") {
        const pn = (p["paramName"] as string) ?? "";
        if (!ALLOWED_DIM_PARAMS.has(pn)) {
          throw new Error(`Unknown parameter “${pn}” — try widthMm, heightMm, depthMm, radiusMm.`);
        }
        // C3: per-param value gate (txMm=0/-50, rxDeg=0/-90 legal).
        if (p["valueMm"] !== undefined && p["valueMm"] !== null) {
          if (!validSetDimensionValue(pn, p["valueMm"])) {
            throw new Error(`Bad valueMm for ${pn} — out of range for that parameter.`);
          }
        }
        // Formulas ride the same path (Phase 9a): charset + length checked
        // here, semantics validated core-side.
        const expr = p["expression"];
        if (expr !== undefined && expr !== null) {
          if (!validExpression(expr)) {
            throw new Error(
              "Bad expression — numbers, parameter names and + - * / ( ) only.",
            );
          }
        } else if (p["valueMm"] === undefined || p["valueMm"] === null) {
          throw new Error("SetDimension needs valueMm or an expression.");
        }
      }
      if (step.command === "CreateHolesCorners") {
        const c = (p["count"] as number) ?? 0;
        if (c !== 1 && c !== 4) throw new Error(`Corner patterns support 1 or 4 holes, got ${c}.`);
      }
      continue;
    }
    const def = COMMANDS.find((c) => c.id === step.command);
    if (!def) throw new Error(`Unknown command in plan: ${step.command}`);
    // Zod validation of every field (§63.10) — unknown target ids and bad
    // types are rejected here, before anything touches the core.
    const parsed = def.parameterSchema.parse(params) as Record<string, unknown>;
    // M12: LLM SetDimension.expression needs the same charset/length gate
    // as local (zod only caps length) — fail fast before the round-trip.
    if (step.command === "SetDimension" && parsed["expression"] !== undefined && parsed["expression"] !== null) {
      if (!validExpression(parsed["expression"])) {
        throw new Error("Bad expression — numbers, parameter names and + - * / ( ) only.");
      }
    }
    // LLM semantic checks: ids must resolve against the live document.
    if (store && typeof parsed["targetId"] === "string") {
      const tid = parsed["targetId"] as string;
      if (!store.features.some((f) => f.featureId === tid)) {
        throw new Error(`Unknown target “${tid}” — use a selected body id.`);
      }
    }
    if (store && typeof parsed["featureId"] === "string") {
      const fid = parsed["featureId"] as string;
      if (!store.features.some((f) => f.featureId === fid)) {
        throw new Error(`Unknown feature “${fid}”.`);
      }
    }
    if (store && typeof parsed["faceRole"] === "string" && typeof parsed["targetId"] === "string") {
      const mesh = store.meshes[parsed["targetId"] as string];
      const want = `${parsed["targetId"]}:${parsed["faceRole"]}`;
      if (!mesh || !mesh.faces.some((f) => f.persistentFaceId === want)) {
        throw new Error(`Face “${want}” is not on that solid — select the face first.`);
      }
    }
    if (store && Array.isArray(parsed["edgeIds"]) && typeof parsed["targetId"] === "string") {
      const tid = parsed["targetId"] as string;
      const bad = (parsed["edgeIds"] as string[]).filter((e) => !e.startsWith(`${tid}:`));
      if (bad.length > 0) throw new Error("All edges must belong to the target solid.");
    }
  }
}

/**
 * Local deterministic provider: wraps the parser so UI code has one path.
 * Never calls any model — the "AI" here is grammar (§57).
 */
export class LocalParserProvider implements IntentModelProvider {
  readonly id = "local";
  async plan(request: IntentRequest): Promise<IntentPlan> {
    const { parseCommand } = await import("./parse");
    const r = parseCommand(request.text);
    if (!r.ok) throw new Error(r.message);
    return r.plan;
  }
}

/**
 * OpenAI-compatible HTTP provider (local LLM server or hosted endpoint).
 * Sends the registry tool definitions + structured context; maps tool_calls
 * back to plan steps and validates every field. The model NEVER emits
 * geometry — only registered command ids with schema-checked params (§28).
 */
export class HttpLlmProvider implements IntentModelProvider {
  readonly id = "http-llm";
  constructor(
    private endpoint: string,
    private model: string,
    private apiKey?: string,
  ) {}

  async plan(request: IntentRequest): Promise<IntentPlan> {
    const numProp = (min?: number, max?: number) => ({
      type: "number" as const,
      ...(min !== undefined ? { minimum: min } : {}),
      ...(max !== undefined ? { maximum: max } : {}),
    });
    const tools = COMMANDS.filter((c) =>
      [
        "CreateBox",
        "CreateCylinder",
        "CreateSphere",
        "CreateHole",
        "CreateFillet",
        "CreateChamfer",
        "CreateInstance",
        "SetDimension",
        "Undo",
        "Redo",
      ].includes(c.id),
    ).map((c) => ({
      type: "function" as const,
      function: {
        name: c.id,
        description: c.description,
        parameters: {
          type: "object",
          properties: {
            ...(c.id === "CreateBox"
              ? {
                  widthMm: numProp(0.01, 100000),
                  heightMm: numProp(0.01, 100000),
                  depthMm: numProp(0.01, 100000),
                }
              : {}),
            ...(c.id === "CreateCylinder"
              ? { radiusMm: numProp(0.01, 50000), heightMm: numProp(0.01, 100000) }
              : {}),
            ...(c.id === "CreateSphere" ? { radiusMm: numProp(0.01, 50000) } : {}),
            ...(c.id === "CreateHole"
              ? {
                  targetId: { type: "string" },
                  faceRole: { type: "string" },
                  xMm: { type: "number" },
                  yMm: { type: "number" },
                  // M7: cap matches the core gate (0, 100000].
                  diameterMm: numProp(0.01, 100000),
                  depthMode: { type: "string", enum: ["throughAll", "blind"] },
                  depthMm: numProp(0, 100000),
                }
              : {}),
            ...(c.id === "CreateFillet" ? {
              targetId: { type: "string" },
              edgeIds: { type: "array", items: { type: "string" } },
              radiusMm: numProp(0.01, 50000),
            } : {}),
            ...(c.id === "CreateChamfer" ? {
              targetId: { type: "string" },
              edgeIds: { type: "array", items: { type: "string" } },
              distanceMm: numProp(0.01, 50000),
            } : {}),
            ...(c.id === "CreateInstance" ? {
              targetId: { type: "string" },
              txMm: { type: "number" },
              tyMm: { type: "number" },
              tzMm: { type: "number" },
              rxDeg: { type: "number" },
              ryDeg: { type: "number" },
              rzDeg: { type: "number" },
            } : {}),
            ...(c.id === "SetDimension" ? {
              featureId: { type: "string" },
              paramName: { type: "string", enum: [...ALLOWED_DIM_PARAMS] },
              // C3: value range is param-dependent (txMm=0/-50 legal) — the
              // model sends any finite number, core + validatePlan own gates.
              valueMm: { type: "number" },
              expression: { type: "string", maxLength: 256, pattern: "^[0-9A-Za-z_+*/(). \\t-]+$" },
            } : {}),
          },
          required: c.id === "CreateBox"
            ? ["widthMm", "heightMm", "depthMm"]
            : c.id === "CreateHole"
              ? ["targetId", "faceRole", "xMm", "yMm", "diameterMm", "depthMode"]
              : c.id === "CreateInstance"
                ? ["targetId"]
                : c.id === "SetDimension"
                  ? ["featureId", "paramName"]
                  : [],
          ...(c.id === "SetDimension"
            ? {
                anyOf: [
                  { required: ["featureId", "paramName", "valueMm"] },
                  { required: ["featureId", "paramName", "expression"] },
                ],
              }
            : {}),
        },
      },
    }));

    const system = [
      "You drive a parametric B-Rep CAD app. Output ONLY tool calls.",
      "Units are millimeters. Never invent ids: use exactly the selection",
      "and body ids given in context. Prefer few steps (max 12).",
      `Context: ${JSON.stringify(request)}`,
    ].join(" ");

    const hostOf = (ep: string): string => {
      try {
        return new URL(ep).host || "the model server";
      } catch {
        return "the model server";
      }
    };
    let res: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        res = await fetch(`${this.endpoint.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: request.text },
            ],
            tools,
            tool_choice: "auto",
            max_tokens: 2000,
          }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const host = hostOf(this.endpoint);
      throw new Error(
        `Language model unreachable at ${host} (${e instanceof Error && e.name === "AbortError" ? "timed out after 15 s" : e instanceof Error ? e.message : "network error"}) — try short commands like “box 100 50 20”.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Language model error ${res.status} — try short commands like “box 100 50 20”.`,
      );
    }
    const body = (await res.json()) as {
      choices?: {
        message?: {
          tool_calls?: { function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const calls = (body.choices?.[0]?.message?.tool_calls ?? []).slice(0, 12);
    if (calls.length === 0) {
      throw new Error("The model returned no commands — try rephrasing or short syntax.");
    }
    const steps = calls.map((c) => {
      let params: unknown = {};
      try {
        params = JSON.parse(c.function.arguments || "{}");
      } catch {
        throw new Error(`Bad model arguments for ${c.function.name} — try short syntax.`);
      }
      if (typeof params !== "object" || params === null) {
        throw new Error(`Bad model arguments for ${c.function.name} — try short syntax.`);
      }
      return { command: c.function.name, params } as PlanStep;
    });
    const plan: IntentPlan = {
      steps,
      source: "llm",
      text: request.text,
    };
    validatePlan(plan);
    return plan;
  }
}

// ── Plan execution (shared by local + LLM plans) ─────────────────────

export interface PlanResult {
  executed: number;
  errors: string[];
}

/** Face with the highest centroid Z (top-face heuristic for patterns). */
function topFaceOf(
  mesh: { faces: FaceRange[]; positions: Float32Array; indices: Uint32Array },
): string | null {  let best: string | null = null;
  let bestZ = -Infinity;
  for (const f of mesh.faces) {
    // Average up to 16 triangles (not just the first): side faces whose
    // first triangle sits at the top edge no longer beat the true top.
    const tris = Math.min(f.triangleCount, 16);
    if (tris <= 0) continue;
    let cz = 0;
    let n = 0;
    for (let tt = 0; tt < tris; tt++) {
      for (let k = 0; k < 3; k++) {
        const vi = mesh.indices[(f.triangleStart + tt) * 3 + k];
        if (vi === undefined) break;
        cz += mesh.positions[vi * 3 + 2] ?? 0;
        n++;
      }
    }
    if (n > 0 && cz / n > bestZ) {
      bestZ = cz / n;
      best = f.persistentFaceId;
    }
  }
  return best;
}

/**
 * Execute a validated plan step by step through the single typed path
 * (§0.4 — no hidden geometry path for AI). Selection-dependent steps
 * resolve against the LIVE selection at execution time.
 */
export async function runPlan(plan: IntentPlan): Promise<PlanResult> {
  validatePlan(plan);
  const errors: string[] = [];
  let executed = 0;

  const selectedFace = (): { targetId: string; faceRole: string } | null => {
    const sel = useSelectionStore.getState().selectedIds;
    // Face ids are "<body>:<role>" (e.g. "<feat>:box.+Z"); edges are "<body>:edge.…".
    const faces = sel.filter((id) => {
      const cut = id.indexOf(":");
      if (cut < 0) return false;
      if (id.slice(cut + 1).startsWith("edge.")) return false;
      if (isSketchId(id.slice(0, cut))) return false;
      return true;
    });
    if (faces.length === 0) return null;
    if (faces.length > 1) throw new Error(`Select a single face (got ${faces.length})`);
    const face = faces[0]!;
    const cut = face.indexOf(":");
    return { targetId: face.slice(0, cut), faceRole: face.slice(cut + 1) };
  };
  const selectedEdges = (): { targetId: string; edgeIds: string[] } | null => {
    const sel = useSelectionStore.getState().selectedIds;
    const edges = sel.filter((id) => id.includes(":edge."));
    if (edges.length === 0) return null;
    const targetId = edges[0]!.slice(0, edges[0]!.indexOf(":"));
    if (!edges.every((e) => e.startsWith(`${targetId}:`))) {
      throw new Error("Select edges of a single solid");
    }
    return { targetId, edgeIds: edges };
  };
  const selectedBody = (): string | null => {
    const sel = useSelectionStore.getState().selectedIds;
    const bare = sel.find(
      (id) => !id.includes(":") && !isSketchId(id),
    );
    if (bare) return bare;
    // A face/edge selection implies its body (common after "hole 8").
    const implied = sel.find((id) => id.includes(":"));
    if (implied) {
      const tid = implied.slice(0, implied.indexOf(":"));
      if (!isSketchId(tid)) return tid;
    }
    return null;
  };

  for (const step of plan.steps) {
    try {
      switch (step.command) {
        case "CreateBox":
        case "CreateCylinder":
        case "CreateSphere":
          await executeCommand(step.command, step.params, { skipAvailability: true });
          break;
        case "CreateInstance": {
          const p = step.params as {
            targetId?: string;
            txMm?: number;
            tyMm?: number;
            tzMm?: number;
            rxDeg?: number;
            ryDeg?: number;
            rzDeg?: number;
          };
          // Explicit target wins; otherwise the live body selection.
          const targetId = p.targetId ?? selectedBody();
          if (!targetId) throw new Error("Select a solid body first");
          await executeCommand("CreateInstance", {
            targetId,
            txMm: p.txMm ?? 0,
            tyMm: p.tyMm ?? 0,
            tzMm: p.tzMm ?? 0,
            rxDeg: p.rxDeg ?? 0,
            ryDeg: p.ryDeg ?? 0,
            rzDeg: p.rzDeg ?? 0,
          }, { skipAvailability: true });
          break;
        }
        case "CreateHole": {
          const face = selectedFace();
          if (!face) throw new Error("Select a face first");
          const p = step.params;
          // "center" default: face centroid mapped through the core frame.
          let xMm = 0;
          let yMm = 0;
          if (p.position === "center" || (p.xMm === undefined && p.yMm === undefined)) {
            const { coreClient } = await import("../ipc/coreClient");
            const { faceCentroid, faceLocalFromWorld } = await import("../interaction/pull");
            const store = useDocumentUiStore.getState();
            const mesh = store.meshes[face.targetId];
            if (!mesh) throw new Error("Face mesh not loaded yet");
            // World centroid of the selected face (first triangles).
            const c = faceCentroid(
              mesh,
              `${face.targetId}:${face.faceRole}`,
              16,
            );
            if (!c) throw new Error("Face not in current mesh");
            const frame = await coreClient.requestFaceInfo(
              face.targetId,
              face.faceRole,
            );
            const local = faceLocalFromWorld(frame, c);
            xMm = local.x;
            yMm = local.y;
            if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) {
              throw new Error("Face center unavailable — select the face again");
            }
          } else {
            xMm = (p as { xMm?: number }).xMm ?? 0;
            yMm = (p as { yMm?: number }).yMm ?? 0;
          }
          await executeCommand("CreateHole", {
            targetId: face.targetId,
            faceRole: face.faceRole,
            xMm,
            yMm,
            diameterMm: p.diameterMm,
            depthMode: p.depthMode,
            depthMm: p.depthMm,
          }, { skipAvailability: true });
          break;
        }
        case "CreateHolesCorners": {
          const targetId = selectedBody();
          if (!targetId) throw new Error("Select a solid body first");
          const store = useDocumentUiStore.getState();
          // Tips-only hydration prunes non-tip ancestor meshes: read corner
          // math from the owning body's TIP mesh. The tip derives from the
          // base by subtractive cuts, so plate-corner extents are identical
          // (downstream cuts sit far from the insets); the committed
          // targetId below is unchanged, preserving deps/sibling structure.
          const owner = store.bodies.find((b) => b.history.includes(targetId));
          const meshId = owner ? owner.tipFeatureId : targetId;
          let mesh = store.meshes[meshId];
          if (!mesh) {
            const { pullFeatureMesh } = await import("../model/sync");
            await pullFeatureMesh(meshId, store.revision);
            mesh = useDocumentUiStore.getState().meshes[meshId];
          }
          if (!mesh) throw new Error("Body mesh not loaded yet");
          const topId = topFaceOf(mesh);
          if (!topId) throw new Error("No top face found on the body");
          const cut = topId.indexOf(":");
          const faceRole = topId.slice(cut + 1);
          const { coreClient } = await import("../ipc/coreClient");
          const frame = await coreClient.requestFaceInfo(targetId, faceRole);
          // Face-local extents: iterate ONLY the top-face triangles (never the
          // whole body — a fused second solid below must not inflate corners).
          const topRange = mesh.faces.find((f) => f.persistentFaceId === topId);
          if (!topRange || topRange.triangleCount <= 0) {
            throw new Error("Face extents unavailable");
          }
          let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
          const topTris = Math.min(topRange.triangleCount, 256);
          for (let tt = 0; tt < topTris; tt++) {
            for (let k = 0; k < 3; k++) {
              const vi = mesh.indices[(topRange.triangleStart + tt) * 3 + k]!;
              const wx = mesh.positions[vi * 3]!;
              const wy = mesh.positions[vi * 3 + 1]!;
              const wz = mesh.positions[vi * 3 + 2]!;
              const dx = wx - frame.originMm[0];
              const dy = wy - frame.originMm[1];
              const dz = wz - frame.originMm[2];
              const lx =
                dx * frame.xAxis[0] + dy * frame.xAxis[1] + dz * frame.xAxis[2];
              const ly =
                dx * frame.yAxis[0] + dy * frame.yAxis[1] + dz * frame.yAxis[2];
              x0 = Math.min(x0, lx);
              y0 = Math.min(y0, ly);
              x1 = Math.max(x1, lx);
              y1 = Math.max(y1, ly);
            }
          }
          if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 <= x0) {
            throw new Error("Face extents unavailable");
          }
          const p = step.params;
          const w = x1 - x0;
          const h = y1 - y0;
          if (p.count !== 1) {
            if (w < 2 * p.insetMm + p.diameterMm || h < 2 * p.insetMm + p.diameterMm) {
              const maxInset = Math.max(0, (Math.min(w, h) - p.diameterMm) / 2);
              throw new Error(
                `Inset ${p.insetMm} too large for a ${w.toFixed(1)}×${h.toFixed(1)} face — max ${maxInset.toFixed(1)}`,
              );
            }
          }
          const pts =
            p.count === 1
              ? [[(x0 + x1) / 2, (y0 + y1) / 2]]
              : [
                  [x0 + p.insetMm, y0 + p.insetMm],
                  [x1 - p.insetMm, y0 + p.insetMm],
                  [x0 + p.insetMm, y1 - p.insetMm],
                  [x1 - p.insetMm, y1 - p.insetMm],
                ];
          // M11: one core transaction (one Undo step) via CreateHolePattern.
          const flat: number[] = (pts as number[][]).flat();
          await executeCommand("CreateHolePattern", {
            targetId,
            faceRole,
            featureIds: (pts as unknown[]).map(
              () => `ho-${crypto.randomUUID()}`,
            ),
            pointsMm: flat,
            diameterMm: p.diameterMm,
            depthMode: p.depthMode,
            depthMm: p.depthMm,
          }, { skipAvailability: true });
          break;
        }
        case "CreateFillet":
        case "CreateChamfer": {
          const edges = selectedEdges();
          if (!edges) throw new Error("Select edges first");
          const v =
            step.command === "CreateFillet"
              ? (step.params as { radiusMm: number }).radiusMm
              : (step.params as { distanceMm: number }).distanceMm;
          await executeCommand(step.command, {
            targetId: edges.targetId,
            edgeIds: edges.edgeIds,
            ...(step.command === "CreateFillet"
              ? { radiusMm: v }
              : { distanceMm: v }),
          }, { skipAvailability: true });
          break;
        }
        case "SetDimension": {
          const body = selectedBody();
          if (!body) throw new Error("Select a solid body first");
          const sp = step.params as {
            paramName: string;
            valueMm?: number;
            expression?: string;
          };
          await executeCommand("SetDimension", {
            featureId: body,
            paramName: sp.paramName,
            ...(sp.valueMm !== undefined ? { valueMm: sp.valueMm } : {}),
            ...(sp.expression ? { expression: sp.expression } : {}),
          }, { skipAvailability: true });
          break;
        }
        case "Undo":
        case "Redo":
          await executeCommand(step.command, {}, { skipAvailability: true });
          break;
        case "View":
          if (
            !viewportSetView(
              (step.params as { name: string }).name as ViewName,
            )
          ) {
            throw new Error("Viewport not ready");
          }
          break;
        case "Help":
          break;
      }
      executed++;
    } catch (e) {
      // Stop at first failure (§41): a partial plan beats a corrupt one,
      // and the error names the exact step.
      errors.push(
        `Step ${executed + 1} (${step.command}): ${e instanceof Error ? e.message : "failed"}`,
      );
      break;
    }
  }
  return { executed, errors };
}