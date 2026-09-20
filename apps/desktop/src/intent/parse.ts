// Deterministic local command parser (§57): short exact syntax parsed
// without any LLM — zero latency, zero cost, works offline. Genuine natural
// language falls through to the provider layer (provider.ts).

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
      message: `Use “.” for decimals (e.g. “2.5”), not commas — commas separate values.`,
    };
  }
  const t = tokens(input);
  if (t.length === 0) return { ok: false, reason: "empty", message: "Empty command." };
  const head = t[0]!;

  if (head === "help" || head === "?") {
    return {
      ok: true,
      plan: { steps: [{ command: "Help", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "box" || head === "plate") {
    const w = num(t[1]);
    const h = num(t[2]);
    const d = num(t[3]);
    if (w === null || h === null || d === null || t.length > 4) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: box <width> <height> <depth> — e.g. “box 100 50 20”.`,
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
    const r = num(t[1]);
    const h = num(t[2]);
    if (r === null || h === null || t.length > 3) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: cylinder <radius> <height> — e.g. “cylinder 20 60”.`,
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
    const r = num(t[1]);
    if (r === null || t.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: sphere <radius> — e.g. “sphere 25”.`,
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
    const dia = numOrWord(t[1]);
    if (dia === null) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: holes <diameter> [count <n>] corners <inset> — e.g. “holes 6 4 corners 8”.`,
      };
    }
    let rest = t.slice(2);
    let n = 4;
    if (rest[0] === "count") {
      const c = count(rest[1]);
      if (c === null || (c !== 1 && c !== 4)) {
        return {
          ok: false,
          reason: "invalid",
          message: `Corner patterns support 1 (center) or 4 holes, got “${rest[1] ?? ""}”.`,
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
        (rest[1] === "corners" || rest[1] === "corner")
      ) {
        n = c;
        rest = rest.slice(1);
      }
    }
    if (rest[0] !== "corners" && rest[0] !== "corner") {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: holes <diameter> [count <n>] corners <inset> — e.g. “holes 6 4 corners 8”.`,
      };
    }
    // Allow "corners 8", "corners 8mm", "corners from 8".
    const insetTok = rest[1] === "from" ? rest[2] : rest[1];
    const inset = num(insetTok);
    if (inset === null) {
      return {
        ok: false,
        reason: "invalid",
        message: `Corner inset must be a positive dimension — e.g. “holes 6 4 corners 8”.`,
      };
    }
    rest = rest[1] === "from" ? rest.slice(3) : rest.slice(2);
    let depthMode: "throughAll" | "blind" = "throughAll";
    let depthMm = 0;
    if (rest.length > 0) {
      if (rest[0] !== "blind") {
        return {
          ok: false,
          reason: "invalid",
          message: `Only “blind <depth>” may follow — e.g. “holes 6 4 corners 8 blind 5”.`,
        };
      }
      const d = num(rest[1]);
      if (d === null) {
        return {
          ok: false,
          reason: "invalid",
          message: `Blind depth must be positive — e.g. “holes 6 4 corners 8 blind 5”.`,
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
        message: `Unexpected “${rest.join(" ")}” — try “holes 6 4 corners 8”.`,
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
    const dia = numOrWord(t[1]);
    if (dia === null) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: hole <diameter> [blind <depth>] — needs a selected face.`,
      };
    }
    let depthMode: "throughAll" | "blind" = "throughAll";
    let depthMm = 0;
    if (t.length > 2) {
      if (t[2] !== "blind") {
        return {
          ok: false,
          reason: "invalid",
          message: `Usage: hole <diameter> [blind <depth>] — e.g. “hole 8”.`,
        };
      }
      const d = num(t[3]);
      if (d === null || t.length > 4) {
        return {
          ok: false,
          reason: "invalid",
          message: `Usage: hole <diameter> [blind <depth>] — e.g. “hole 8 blind 5”.`,
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
    const r = num(t[1]);
    if (r === null || t.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: fillet <radius> — needs selected edges.`,
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
    const d = num(t[1]);
    if (d === null || t.length > 2) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: chamfer <distance> — needs selected edges.`,
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
        message: `Usage: set <parameter> <value> — e.g. “set widthMm 150”.`,
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
          message: `Usage: set <parameter> =<formula> — e.g. “set widthMm =heightMm * 2”.`,
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
    const v = num(t[2]);
    if (v === null || t.length > 3) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: set <parameter> <value> — e.g. “set widthMm 150”.`,
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
    if (t.length > 1) return { ok: false, reason: "unparsed", message: input.trim() };
    return {
      ok: true,
      plan: { steps: [{ command: "Undo", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "redo") {
    if (t.length > 1) return { ok: false, reason: "unparsed", message: input.trim() };
    return {
      ok: true,
      plan: { steps: [{ command: "Redo", params: {} }], source: "local", text: input.trim() },
    };
  }

  if (head === "view" || (VIEW_NAMES as string[]).includes(head)) {
    const name = head === "view" ? t[1] : head;
    if (!name || !VIEW_NAMES.includes(name) || t.length > (head === "view" ? 2 : 1)) {
      return {
        ok: false,
        reason: "invalid",
        message: `Usage: view <${VIEW_NAMES.join("|")}>.`,
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
      message: `“${head}” lives in the toolbar (save/open icons: .icad, STEP, 3MF, STL, OBJ, glTF).`,
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
  if (/[a-z]{3,}/.test(head) && t.length >= 2) {
    return { ok: false, reason: "unparsed", message: input.trim() };
  }
  return {
    ok: false,
    reason: "invalid",
    message: `Unknown command “${input.trim()}” — try “help”.`,
  };
}

/** One-line human rendering of a plan step (preview UI). */
export function describeStep(step: PlanStep): string {
  switch (step.command) {
    case "CreateBox": {
      const p = step.params;
      return `Box ${p.widthMm}×${p.heightMm}×${p.depthMm} mm`;
    }
    case "CreateCylinder":
      return `Cylinder ⌀${step.params.radiusMm * 2}×${step.params.heightMm} mm`;
    case "CreateSphere":
      return `Sphere ⌀${step.params.radiusMm * 2} mm`;
    case "CreateHole":
      return step.params.depthMode === "blind"
        ? `Hole ⌀${step.params.diameterMm} × ${step.params.depthMm} deep`
        : `Hole ⌀${step.params.diameterMm} through`;
    case "CreateHolesCorners": {
      const p = step.params;
      const depth =
        p.depthMode === "blind" ? ` blind ${p.depthMm} deep` : " through";
      return p.count === 1
        ? `Center hole ⌀${p.diameterMm}${depth}`
        : `${p.count} ⌀${p.diameterMm} holes, ${p.insetMm} mm from corners${depth}`;
    }
    case "CreateFillet":
      return `Fillet R${step.params.radiusMm} on selected edges`;
    case "CreateChamfer":
      return `Chamfer ${step.params.distanceMm} on selected edges`;
    case "CreateInstance": {
      const p = step.params;
      const t = [p.txMm ?? 0, p.tyMm ?? 0, p.tzMm ?? 0]
        .map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2)))
        .join(", ");
      return `Instance at (${t})`;
    }
    case "SetDimension":
      return step.params.expression !== undefined
        ? `Set ${step.params.paramName} = ${step.params.expression} (formula)`
        : `Set ${step.params.paramName} = ${step.params.valueMm}`;
    case "Undo":
      return "Undo";
    case "Redo":
      return "Redo";
    case "View":
      return `View: ${step.params.name}`;
    case "Help":
      return "Help";
  }
}

/** Short-command cheat sheet for help/hints. */
export const HELP_TEXT =
  "box 100 50 20 · cylinder 20 60 · sphere 25 · hole 8 [blind 5] · holes 6 4 corners 8 · fillet 3 · chamfer 2 · set widthMm 150 · set widthMm =heightMm * 2 · undo · redo · view front · help";
