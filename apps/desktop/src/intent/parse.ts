// Deterministic local command parser (§57): short exact syntax parsed
// without any LLM — zero latency, zero cost, works offline. Genuine natural
// language falls through to the provider layer (provider.ts).
// User-facing messages are localized via the current locale (§i18n).
import { t, getLocale, type EnKey } from "../i18n";

export type PlanStep =
  | { command: "CreateBox"; params: { widthMm: number; heightMm: number; depthMm: number } }
  | { command: "CreateCylinder"; params: { radiusMm: number; heightMm: number } }
  | { command: "CreateSphere"; params: { radiusMm: number } }
  | {
      command: "CreateHole";
      params: {
        diameterMm: number;
        depthMode: "throughAll" | "blind";
        depthMm: number;
        /** Local-parser shorthand (resolved at execution); LLM must send explicit coords. */
        position?: "center";
        targetId?: string;
        faceRole?: string;
        xMm?: number;
        yMm?: number;
      };
    }
  | {
      command: "CreateHolesCorners";
      params: {
        diameterMm: number;
        count: number;
        insetMm: number;
        depthMode: "throughAll" | "blind";
        depthMm: number;
      };
    }
  | { command: "CreateFillet"; params: { radiusMm: number } }
  | { command: "CreateChamfer"; params: { distanceMm: number } }
  | {
      command: "CreateInstance";
      params: {
        targetId?: string;
        txMm?: number;
        tyMm?: number;
        tzMm?: number;
        rxDeg?: number;
        ryDeg?: number;
        rzDeg?: number;
      };
    }
  | {
      command: "SetDimension";
      params: { paramName: string; valueMm?: number; expression?: string };
    }
  | { command: "Undo"; params: Record<string, never> }
  | { command: "Redo"; params: Record<string, never> }
  | { command: "View"; params: { name: string } }
  | { command: "Help"; params: Record<string, never> };

export interface IntentPlan {
  steps: PlanStep[];
  /** 'local' = deterministic parser (no model); 'llm' = validated model output. */
  source: "local" | "llm";
  text: string;
}

export type ParseResult =
  | { ok: true; plan: IntentPlan }
  | { ok: false; reason: "empty" | "unparsed" | "invalid" ; message: string };

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5,
  sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
};

/** Italian command heads accepted alongside English (normalized to canonical). */
const HEAD_ALIASES: Record<string, string> = {
  scatola: "box",
  cilindro: "cylinder",
  tubo: "cylinder",
  sfera: "sphere",
  palla: "sphere",
  fori: "holes",
  foro: "hole",
  raccordo: "fillet",
  arrotonda: "fillet",
  smusso: "chamfer",
  angolo: "chamfer",
  imposta: "set",
  quota: "set",
  annulla: "undo",
  ripeti: "redo",
  vista: "view",
  aiuto: "help",
  esporta: "export",
  salva: "save",
  apri: "open",
};

/** Italian view names mapped to the canonical view id (viewport contract). */
const VIEW_ALIASES: Record<string, string> = {
  alto: "top",
  fronte: "front",
  destra: "right",
  iso: "iso",
  basso: "bottom",
  retro: "back",
  sinistra: "left",
};

const VIEW_LABEL: Record<string, EnKey> = {
  top: "cube.top",
  front: "cube.front",
  right: "cube.right",
  iso: "cube.iso",
  bottom: "cube.bottom",
  back: "cube.back",
  left: "cube.left",
};

/** Tokenize: lowercase, commas as separators (but EU decimals rejected), split units. */
function tokens(input: string): string[] {
  return input
    .trim()
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Raw case-preserving tokens for identifiers like paramName. */
function rawTokens(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Parse a positive dimension, accepting "100", "100mm", "2.5". */
function num(tok: string | undefined): number | null {
  if (!tok) return null;
  // EU decimal comma "2,5" would have been split — catch the original form
  // in parseCommand; here a bare "," token is never a number.
  if (tok.includes(",")) return null;
  const m = tok.match(/^(-?\d+(?:\.\d+)?)(mm|cm|m|in)?$/);
  if (!m) return null;
  let v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = m[2];
  if (unit === "cm") v *= 10;
  else if (unit === "m") v *= 1000;
  else if (unit === "in") v *= 25.4;
  if (!(v > 0)) return null;
  // Match protocol cap (CreateBoxPayload max 100000): fail fast with usage.
  if (v > 100000) return null;
  return v;
}

/** Diameter/count accept word-numbers too ("six" → 6). */
function numOrWord(tok: string | undefined): number | null {
  if (!tok) return null;
  const n = num(tok);
  if (n !== null) return n;
  const w = WORD_NUMBERS[tok.toLowerCase()];
  return w !== undefined && w > 0 ? w : null;
}

function count(tok: string | undefined): number | null {
  if (!tok) return null;
  if (WORD_NUMBERS[tok] !== undefined) return WORD_NUMBERS[tok];
  const n = Number(tok);
  return Number.isInteger(n) && n > 0 && n <= 10 ? n : null;
}

const VIEW_NAMES = ["top", "front", "right", "iso", "bottom", "back", "left"];

/** Italian view names shown in usage (same order as VIEW_NAMES). */
const VIEW_NAMES_IT = ["alto", "fronte", "destra", "iso", "basso", "retro", "sinistra"];

/**
 * Parse one line of short syntax. Returns unparsed (not invalid) for
 * genuine prose so the caller can route to the LLM provider.
 */
export function parseCommand(input: string): ParseResult {
  // EU decimal comma ("2,5") is never valid — point at "." explicitly.
  if (/(\d),(\d)/.test(input.trim())) {
    return {
      ok: false,
      reason: "invalid",
      message: t("parse.decimals"),
    };
  }
  const tks = tokens(input);
  if (tks.length === 0) return { ok: false, reason: "empty", message: t("parse.empty") };
  const rawHead = tks[0]!;
  const head = HEAD_ALIASES[rawHead] ?? VIEW_ALIASES[rawHead] ?? rawHead;

  if (head === "help" || head === "?") {
    return {
      ok: true,
      plan: { steps: [{ command: "Help", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "box" || head === "plate") {
    const w = num(tks[1]);
    const h = num(tks[2]);
    const d = num(tks[3]);
    if (w === null || h === null || d === null || tks.length > 4) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageBox"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "CreateBox", params: { widthMm: w, heightMm: h, depthMm: d } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "cylinder" || head === "tube") {
    const r = num(tks[1]);
    const h = num(tks[2]);
    if (r === null || h === null || tks.length > 3) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageCylinder"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "CreateCylinder", params: { radiusMm: r, heightMm: h } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "sphere" || head === "ball") {
    const r = num(tks[1]);
    if (r === null || tks.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageSphere"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "CreateSphere", params: { radiusMm: r } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  // holes <dia> [count N] corners <inset> [blind <depth>]
  // e.g. "holes 6 4 corners 8", "four 6mm holes 8mm from corners" is NL.
  if (head === "holes") {
    const dia = numOrWord(tks[1]);
    if (dia === null) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageHoles"),
      };
    }
    let rest = tks.slice(2);
    let n = 4;
    if (rest[0] === "count" || rest[0] === "numero") {
      const c = count(rest[1]);
      if (c === null || (c !== 1 && c !== 4)) {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.cornersCount", { got: rest[1] ?? "" }),
        };
      }
      n = c;
      rest = rest.slice(2);
    } else {
      // Bare count without keyword ("holes 6 4 corners 8").
      const c = count(rest[0]);
      if (
        c !== null &&
        (c === 1 || c === 4) &&
        (rest[1] === "corners" || rest[1] === "corner" || rest[1] === "angoli" || rest[1] === "angolo")
      ) {
        n = c;
        rest = rest.slice(1);
      }
    }
    if (rest[0] !== "corners" && rest[0] !== "corner" && rest[0] !== "angoli" && rest[0] !== "angolo") {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageHoles"),
      };
    }
    // Allow "corners 8", "corners 8mm", "corners from 8" (it: "angoli 8", "da 8").
    const insetTok = rest[1] === "from" || rest[1] === "da" ? rest[2] : rest[1];
    const inset = numOrWord(insetTok);
    if (inset === null) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.cornerInset"),
      };
    }
    rest = rest[1] === "from" || rest[1] === "da" ? rest.slice(3) : rest.slice(2);
    let depthMode: "throughAll" | "blind" = "throughAll";
    let depthMm = 0;
    if (rest.length > 0) {
      if (rest[0] !== "blind" && rest[0] !== "cieco") {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.blindOnly"),
        };
      }
      const d = numOrWord(rest[1]);
      if (d === null) {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.blindDepth"),
        };
      }
      depthMode = "blind";
      depthMm = d;
      rest = rest.slice(2);
    }
    if (rest.length > 0) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.unexpected", { rest: rest.join(" ") }),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [
          {
            command: "CreateHolesCorners",
            params: { diameterMm: dia, count: n, insetMm: inset, depthMode, depthMm },
          },
        ],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "hole") {
    const dia = numOrWord(tks[1]);
    if (dia === null) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageHole"),
      };
    }
    let depthMode: "throughAll" | "blind" = "throughAll";
    let depthMm = 0;
    if (tks.length > 2) {
      if (tks[2] !== "blind" && tks[2] !== "cieco") {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.usageHoleBlind"),
        };
      }
      const d = numOrWord(tks[3]);
      if (d === null || tks.length > 4) {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.usageHoleBlindDepth"),
        };
      }
      depthMode = "blind";
      depthMm = d;
    }
    return {
      ok: true,
      plan: {
        steps: [
          {
            command: "CreateHole",
            params: { diameterMm: dia, depthMode, depthMm, position: "center" },
          },
        ],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "fillet" || head === "round") {
    const r = num(tks[1]);
    if (r === null || tks.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageFillet"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "CreateFillet", params: { radiusMm: r } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "chamfer" || head === "corner") {
    const d = num(tks[1]);
    if (d === null || tks.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageChamfer"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "CreateChamfer", params: { distanceMm: d } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "set" || head === "dimension") {
    // Preserve camelCase: tokens() lowercases, so take paramName from raw input.
    const raw = rawTokens(input);
    const param = raw[1];
    if (!param) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageSet"),
      };
    }
    // Formula form (Phase 9a): everything after the first `=` is the
    // expression, case-preserved from the raw input.
    const eq = input.indexOf("=");
    if (eq >= 0) {
      const expr = input.slice(eq + 1).trim();
      if (!expr) {
        return {
          ok: false,
          reason: "invalid",
          message: t("parse.usageSetFormula"),
        };
      }
      return {
        ok: true,
        plan: {
          steps: [
            { command: "SetDimension", params: { paramName: param, expression: expr } },
          ],
          source: "local",
          text: input.trim(),
        },
      };
    }
    const v = num(tks[2]);
    if (v === null || tks.length > 3) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageSet"),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "SetDimension", params: { paramName: param, valueMm: v } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  if (head === "undo") {
    // "undo the last hole" is prose — route to provider, never silently drop words.
    if (tks.length > 1) return { ok: false, reason: "unparsed", message: input.trim() };
    return {
      ok: true,
      plan: { steps: [{ command: "Undo", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "redo") {
    if (tks.length > 1) return { ok: false, reason: "unparsed", message: input.trim() };
    return {
      ok: true,
      plan: { steps: [{ command: "Redo", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "view" || (VIEW_NAMES as string[]).includes(head)) {
    const rawName = head === "view" ? tks[1] : head;
    const name = (rawName !== undefined ? VIEW_ALIASES[rawName] : undefined) ?? rawName;
    if (!name || !VIEW_NAMES.includes(name) || tks.length > (head === "view" ? 2 : 1)) {
      return {
        ok: false,
        reason: "invalid",
        message: t("parse.usageView", {
          names: (getLocale() === "it" ? VIEW_NAMES_IT : VIEW_NAMES).join("|"),
        }),
      };
    }
    return {
      ok: true,
      plan: {
        steps: [{ command: "View", params: { name } }],
        source: "local",
        text: input.trim(),
      },
    };
  }

  // export/save/open have no command-bar path (Phase 8): honest, not silent.
  // Native save/open (.icad, STEP, 3MF, STL, OBJ, glTF) lives in the toolbar.
  if (head === "export" || head === "save" || head === "open") {
    return {
      ok: false,
      reason: "invalid",
      message: t("parse.exportNote", { head: rawHead }),
    };
  }

  // Genuine prose → provider layer (or honest no-provider message).
  // Unknown heads route to unparsed regardless of length ("bracket" is NL,
  // not a typo to scold); known verbs with bad arity already returned invalid.
  const KNOWN = new Set([
    "help", "?", "box", "plate", "cylinder", "tube", "sphere", "ball",
    "holes", "hole", "fillet", "round", "chamfer", "corner", "set",
    "dimension", "undo", "redo", "view", ...VIEW_NAMES, "export", "save", "open",
  ]);
  if (!KNOWN.has(head)) {
    return { ok: false, reason: "unparsed", message: input.trim() };
  }
  if (/[a-z]{3,}/.test(head) && tks.length >= 2) {
    return { ok: false, reason: "unparsed", message: input.trim() };
  }
  return {
    ok: false,
    reason: "invalid",
    message: t("parse.unknown", { text: input.trim() }),
  };
}

/** One-line human rendering of a plan step (preview UI). */
export function describeStep(step: PlanStep): string {
  switch (step.command) {
    case "CreateBox": {
      const p = step.params;
      return t("parse.stepBox", { w: p.widthMm, h: p.heightMm, d: p.depthMm });
    }
    case "CreateCylinder":
      return t("parse.stepCylinder", { d: step.params.radiusMm * 2, h: step.params.heightMm });
    case "CreateSphere":
      return t("parse.stepSphere", { d: step.params.radiusMm * 2 });
    case "CreateHole":
      return step.params.depthMode === "blind"
        ? t("parse.stepHoleBlind", { d: step.params.diameterMm, depth: step.params.depthMm })
        : t("parse.stepHoleThrough", { d: step.params.diameterMm });
    case "CreateHolesCorners": {
      const p = step.params;
      const tail =
        p.depthMode === "blind"
          ? t("parse.stepHolesBlind", { depth: p.depthMm })
          : t("parse.stepHolesThrough");
      return p.count === 1
        ? t("parse.stepHolesCenter", { d: p.diameterMm, tail })
        : t("parse.stepHolesCorners", { n: p.count, d: p.diameterMm, inset: p.insetMm, tail });
    }
    case "CreateFillet":
      return t("parse.stepFillet", { r: step.params.radiusMm });
    case "CreateChamfer":
      return t("parse.stepChamfer", { d: step.params.distanceMm });
    case "CreateInstance": {
      const p = step.params;
      const coords = [p.txMm ?? 0, p.tyMm ?? 0, p.tzMm ?? 0]
        .map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2)))
        .join(", ");
      return t("parse.stepInstance", { t: coords });
    }
    case "SetDimension":
      return step.params.expression !== undefined
        ? t("parse.stepSetFormula", { p: step.params.paramName, e: step.params.expression })
        : t("parse.stepSet", { p: step.params.paramName, v: step.params.valueMm ?? "" });
    case "Undo":
      return t("parse.stepUndo");
    case "Redo":
      return t("parse.stepRedo");
    case "View": {
      const label = (VIEW_LABEL[step.params.name] ?? null) as EnKey | null;
      return t("parse.stepView", { name: label ? t(label) : step.params.name });
    }
    case "Help":
      return t("parse.stepHelp");
  }
}
