import { useRef, useState } from "react";
import { parseCommand, describeStep, HELP_TEXT, type IntentPlan } from "../intent/parse";
import {
  HttpLlmProvider,
  buildIntentRequest,
  runPlan,
} from "../intent/provider";
import { usePreferencesStore } from "../stores";

/**
 * Command bar (§57): deterministic short commands parsed locally first
 * (no LLM, no latency); genuine NL goes to the configured provider, else
 * an honest no-provider message. Every plan previews before committing,
 * and execution runs through the single typed path (§0.4).
 */
export function CommandBar() {
  const [value, setValue] = useState("");
  const [plan, setPlan] = useState<IntentPlan | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [endpoint, setEndpoint] = useState(
    () => usePreferencesStore.getState().llmEndpoint,
  );
  const [model, setModel] = useState(
    () => usePreferencesStore.getState().llmModel,
  );
  const llmConfigured = usePreferencesStore((s) => s.llmEndpoint !== "");
  const genRef = useRef(0);

  const submit = (): void => {
    if (busy) return;
    const text = value.trim();
    if (!text) return;
    const gen = ++genRef.current;
    setError(null);
    setStatus(null);
    setPlan(null);
    const r = parseCommand(text);
    if (r.ok) {
      if (r.plan.steps[0]?.command === "Help") {
        setStatus(HELP_TEXT);
        return;
      }
      // Local parse → immediate typed preview (§57, no LLM involved).
      setPlan(r.plan);
    } else if (r.reason === "unparsed") {
      if (!llmConfigured) {
        setError(
          "No language model configured — I only understand short commands here. " +
            "Try “box 100 50 20”, or open ⚙ to point at a local OpenAI-compatible server.",
        );
        return;
      }
      // Genuine NL → provider plan with the same validation gate.
      setBusy(true);
      const provider = new HttpLlmProvider(
        usePreferencesStore.getState().llmEndpoint,
        usePreferencesStore.getState().llmModel || "local-model",
      );
      provider
        .plan(buildIntentRequest(text))
        .then((p) => {
          if (genRef.current === gen) setPlan(p);
        })
        .catch((e: unknown) => {
          if (genRef.current !== gen) return;
          setError(e instanceof Error ? e.message : "planning failed");
        })
        .finally(() => {
          if (genRef.current === gen) setBusy(false);
        });
    } else {
      // reason "invalid" (or "empty", unreachable here): actionable syntax help.
      setError(r.message);
    }
  };

  const run = async (): Promise<void> => {
    if (!plan || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await runPlan(plan);
      if (result.errors.length > 0) {
        setError(
          `Stopped after ${result.executed} step${result.executed === 1 ? "" : "s"}: ${result.errors[0]}`,
        );
      } else {
        // M11: hole patterns are one core transaction (one Undo step).
        const suffix =
          plan.steps[0]?.command === "CreateHolesCorners"
            ? ` (hole pattern — one Undo to revert)`
            : "";
        setStatus(
          `Done: ${result.executed} step${result.executed === 1 ? "" : "s"} committed${suffix}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "execution failed");
    } finally {
      // Always clear the preview: a failed plan must never stay runnable.
      setPlan(null);
      setValue("");
      setBusy(false);
    }
  };

  const saveSettings = (): void => {
    const ep = endpoint.trim();
    // Plain-HTTP LLM endpoints send design context in the clear (minor):
    // allow loopback dev servers, warn otherwise — no blocking.
    try {
      const u = new URL(ep);
      if (
        u.protocol === "http:" &&
        u.hostname !== "localhost" &&
        u.hostname !== "127.0.0.1" &&
        u.hostname !== "::1"
      ) {
        setError(
          "That endpoint is plain HTTP — design context would travel unencrypted. Prefer https or a localhost server.",
        );
      }
    } catch {
      // Empty/garbage endpoint: the provider reports it honestly on use.
    }
    usePreferencesStore.getState().setLlm(ep, model.trim() || "local-model");
    setShowSettings(false);
  };

  return (
    <div className="border-t border-white/10 bg-[#11151c] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-amber-300">✦</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Invalidate stale previews: Enter always commits what you see.
            if (plan && e.target.value.trim() !== plan.text) setPlan(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !plan) submit();
            else if (e.key === "Enter" && plan) void run();
            else if (e.key === "Escape") {
              // Abort pending provider resolves; a running commit continues
              // (preview already cleared) so the user never thinks it cancelled.
              genRef.current++;
              setPlan(null);
              setError(null);
              setStatus(null);
              if (!busy) setBusy(false);
            }
          }}
          placeholder="What do you want to do?  e.g. “box 100 50 20” or “holes 6 4 corners 8”"
          className="w-full rounded-md bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/35 focus:bg-white/10"
          data-testid="command-input"
        />
        <button
          onClick={() => setShowSettings((s) => !s)}
          title="Language model settings (optional local server)"
          className="rounded-md px-2 py-1.5 text-sm text-white/50 hover:bg-white/10 hover:text-white"
        >
          ⚙
        </button>
      </div>
      {showSettings && (
        <div className="flex items-center gap-2 px-7 pt-2 text-xs text-white/60">
          <span>LLM endpoint (optional):</span>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:1234/v1"
            className="w-56 rounded-md bg-white/5 px-2 py-1 font-mono outline-none focus:bg-white/10"
          />
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model name"
            className="w-40 rounded-md bg-white/5 px-2 py-1 font-mono outline-none focus:bg-white/10"
          />
          <button
            onClick={saveSettings}
            className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/15"
          >
            Save
          </button>
          <span className="text-white/35">
            Empty = offline short commands only.
          </span>
        </div>
      )}
      {plan && (
        <div
          className="mx-7 mt-2 rounded-md border border-amber-300/25 bg-black/40 px-3 py-2 text-xs"
          data-testid="plan-preview"
        >
          <div className="pb-1 text-white/70">
            Plan ({plan.source === "local" ? "parsed locally, no LLM" : "language model"}):
          </div>
          <ol className="list-decimal pl-5 text-white/85">
            {plan.steps.map((s, i) => (
              <li key={i}>{describeStep(s)}</li>
            ))}
          </ol>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-amber-500/90 px-2.5 py-1 font-medium text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? "Running…" : `Run ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`}
            </button>
            <button
              onClick={() => setPlan(null)}
              className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {status && <div className="px-7 pt-1 text-xs text-white/55">{status}</div>}
      {error && <div className="px-7 pt-1 text-xs text-red-300">{error}</div>}
      {!plan && !status && !error && !showSettings && (
        <div className="px-7 pt-1 text-[11px] text-white/30">
          Short syntax runs offline — try “box 100 50 20”, “holes 6 4 corners 8”, “view front”, “help”.
        </div>
      )}
    </div>
  );
}
