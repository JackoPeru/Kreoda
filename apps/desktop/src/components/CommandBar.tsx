import { useEffect, useRef, useState } from "react";
import { parseCommand, describeStep, type IntentPlan } from "../intent/parse";
import { runPlan } from "../intent/provider";
import { captureHermesReview, revalidateHermesReview, buildHermesTurn, type HermesReview } from "../intent/hermes";
import { useDocumentUiStore, useSelectionStore } from "../stores";
import { useSharedTargetStore } from "../model/shared-targets";
import type { AgentFailure } from "../../electron/session-agent";
import { LOCALES, setLocale, t, useLocale, useT, type Locale } from "../i18n";

/**
 * Command bar (§57): deterministic short commands parsed locally first
 * (no LLM, no latency). Free text reviews the request before explicitly
 * sending it to the contextual Hermes agent through the local session.
 */
export function CommandBar() {
  const [value, setValue] = useState("");
  const [plan, setPlan] = useState<IntentPlan | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [review, setReview] = useState<HermesReview | null>(null);
  const [reply, setReply] = useState<{ request: string; text: string; runId: string } | null>(null);
  const [failure, setFailure] = useState<AgentFailure | null>(null);
  const locale = useLocale();
  const tt = useT();
  const genRef = useRef(0);
  const mounted = useRef(true);
  const valueRef = useRef(value);
  const operation = useRef<object | null>(null);
  const active = useRef<{ review: HermesReview; id: string; cancelSent: boolean } | null>(null);
  const doc = useDocumentUiStore();
  const selectedIds = useSelectionStore(s => s.selectedIds);
  const shared = useSharedTargetStore(s => s.context);
  const contextKey = JSON.stringify([doc.documentId, doc.revision, doc.epoch, doc.connectionGeneration, doc.coreRunning, selectedIds, shared]);

  const stop = (): void => {
    const flow = active.current;
    if (!flow || flow.cancelSent) return;
    flow.cancelSent = true;
    setStatus(tt("cmdbar.hermesStopping"));
    void window.kreoda.agentCancel(flow.review.sessionId, { documentId: flow.review.documentId, voiceRequestId: flow.id }).then(result => {
      if (!mounted.current || active.current !== flow) return;
      if (!result.ok) { setFailure(result.error); setError(tt("cmdbar.hermesCancelFailed")); }
      // cancelRequested / notActive do not prove cancellation or rollback.
    }).catch(() => { if (mounted.current && active.current === flow) setError(tt("cmdbar.hermesCancelFailed")); });
  };
  useEffect(() => {
    genRef.current++; setReview(null);
  }, [contextKey, locale]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; genRef.current++;
      const flow = active.current;
      if (flow && !flow.cancelSent) {
        flow.cancelSent = true;
        void window.kreoda.agentCancel(flow.review.sessionId, { documentId: flow.review.documentId, voiceRequestId: flow.id }).catch(() => {});
      }
    };
  }, []);

  const send = async (): Promise<void> => {
    if (!review || operation.current) return;
    const submitted = review, ticket = genRef.current, own = {};
    operation.current = own; setBusy(true); setError(null); setFailure(null); setReply(null);
    let flow: NonNullable<typeof active.current> | null = null;
    try {
      await revalidateHermesReview(submitted);
      if (!mounted.current || ticket !== genRef.current || valueRef.current.trim() !== submitted.text) return;
      flow = { review: submitted, id: crypto.randomUUID(), cancelSent: false };
      active.current = flow; setReview(null); setStatus(tt("cmdbar.hermesWorking"));
      const result = await window.kreoda.agentTurn(buildHermesTurn(submitted, flow.id));
      if (!mounted.current || active.current !== flow) return;
      setStatus(null); setError(null); setFailure(null);
      if (!result.ok) {
        setFailure(result.error);
        setError(tt(result.error.code === "ROLLBACK_UNCONFIRMED" || result.error.status === "uncertain" ? "cmdbar.hermesUncertain" : result.error.code === "CANCELLED" ? "cmdbar.hermesCancelled" : "cmdbar.hermesFailed"));
      } else {
        const response = result.result;
        if (response.sessionId !== submitted.sessionId || response.documentId !== submitted.documentId || response.voiceRequestId !== flow.id ||
            !Number.isSafeInteger(response.revision) || response.revision < submitted.revision || !response.reply.runId || typeof response.reply.text !== "string") throw new Error("AGENT_REPLY_INVALID");
        setReply({ request: submitted.text, text: response.reply.text, runId: response.reply.runId });
      }
    } catch {
      if (mounted.current) { setStatus(null); setReview(null); setError(tt(flow ? "cmdbar.hermesFailed" : "cmdbar.hermesContextChanged")); }
    } finally {
      if (flow && active.current === flow) active.current = null;
      if (operation.current === own) { operation.current = null; if (mounted.current) setBusy(false); }
    }
  };

  const submit = (): void => {
    if (operation.current) return;
    const text = value.trim();
    if (!text) return;
    const gen = ++genRef.current;
    setError(null);
    setStatus(null);
    setPlan(null);
    setReview(null); setReply(null); setFailure(null);
    const r = parseCommand(text);
    if (r.ok) {
      if (r.plan.steps[0]?.command === "Help") {
        setStatus(tt("parse.help"));
        return;
      }
      // Local parse → immediate typed preview (§57, no LLM involved).
      setPlan(r.plan);
    } else if (r.reason === "unparsed") {
      if (!window.kreoda?.agentStatus || !window.kreoda?.agentTurn || !window.kreoda?.agentCancel || !window.kreoda?.sessionSnapshot) {
        setError(tt("cmdbar.hermesUnavailable"));
        return;
      }
      const own = {}; operation.current = own;
      setBusy(true);
      void (async () => {
        try {
          const prepared = await captureHermesReview(text, locale);
          if (!mounted.current || genRef.current !== gen) return;
          const state = await window.kreoda.agentStatus(prepared.sessionId);
          if (!mounted.current || genRef.current !== gen) return;
          if (!state.ok || !state.result.configured || !state.result.reachable) { setError(tt("cmdbar.hermesUnavailable")); return; }
          if (state.result.sessionId !== prepared.sessionId || state.result.documentId !== prepared.documentId || state.result.revision !== prepared.revision) throw new Error("CAD_CONTEXT_CHANGED");
          await revalidateHermesReview(prepared);
          if (mounted.current && genRef.current === gen) setReview(prepared);
        } catch (e) {
          if (mounted.current && genRef.current === gen) setError(tt(e instanceof Error && e.message === "CAD_SELECTION_INVALID" ? "cmdbar.hermesSelectionInvalid" : "cmdbar.hermesContextChanged"));
        } finally {
          if (operation.current === own) { operation.current = null; if (mounted.current) setBusy(false); }
        }
      })();
    } else {
      // reason "invalid" (or "empty", unreachable here): actionable syntax help.
      setError(r.message);
    }
  };

  const run = async (): Promise<void> => {
    if (!plan || operation.current) return;
    const own = {}; operation.current = own;
    const submittedText = valueRef.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await runPlan(plan);
      if (result.errors.length > 0) {
        const n = result.executed;
        setError(
          n === 1
            ? tt("cmdbar.stoppedOne", { err: result.errors[0] ?? "" })
            : tt("cmdbar.stoppedMany", { n, err: result.errors[0] ?? "" }),
        );
      } else {
        // M11: hole patterns are one core transaction (one Undo step).
        const tail =
          plan.steps[0]?.command === "CreateHolesCorners"
            ? tt("cmdbar.donePatternTail")
            : "";
        const n = result.executed;
        setStatus(
          n === 1
            ? tt("cmdbar.doneOne", { tail })
            : tt("cmdbar.doneMany", { n, tail }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("cmdbar.errExecutionFailed"));
    } finally {
      // Always clear the preview: a failed plan must never stay runnable.
      setPlan(null);
      if (valueRef.current === submittedText) { setValue(""); valueRef.current = ""; }
      if (operation.current === own) operation.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="px-1 py-0.5" data-testid="command-bar">
      <div className="flex items-center gap-2">
        <span className="text-amber-300">✦</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            valueRef.current = e.target.value; genRef.current++; setReview(null);
            // Invalidate stale previews: Enter always commits what you see.
            if (plan && e.target.value.trim() !== plan.text) setPlan(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && review) void send();
            else if (e.key === "Enter" && !plan) submit();
            else if (e.key === "Enter" && plan) void run();
            else if (e.key === "Escape") {
              if (active.current) { stop(); return; }
              genRef.current++;
              setReview(null);
              setPlan(null);
              setError(null);
              setStatus(null);
              if (!busy) setBusy(false);
            }
          }}
          placeholder={tt("cmdbar.placeholder")}
          className="w-full rounded-md bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/35 focus:bg-white/10"
          data-testid="command-input"
        />
        <button
          onClick={() => setShowSettings((s) => !s)}
          title={tt("cmdbar.settingsTitle")}
          className="rounded-md px-2 py-1.5 text-sm text-white/50 hover:bg-white/10 hover:text-white"
        >
          ⚙
        </button>
      </div>
      {showSettings && (
        <div className="flex flex-wrap items-center gap-2 px-7 pt-2 text-xs text-white/60">
          <span>{tt("cmdbar.langLabel")}</span>
          <select
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value as Locale);
            }}
            className="rounded-md bg-white/5 px-2 py-1 outline-none focus:bg-white/10"
            aria-label={tt("cmdbar.langLabel")}
            data-testid="locale-select"
          >
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {plan && (
        <div
          className="mx-7 mt-2 rounded-md border border-amber-300/25 bg-black/40 px-3 py-2 text-xs"
          data-testid="plan-preview"
        >
          <div className="pb-1 text-white/70">
            {tt("cmdbar.planTitle", { source: plan.source === "local" ? tt("cmdbar.planLocal") : tt("cmdbar.planLlm") })}
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
              {busy ? tt("common.running") : plan.steps.length === 1 ? tt("cmdbar.runOne") : tt("cmdbar.runMany", { n: plan.steps.length })}
            </button>
            <button
              onClick={() => setPlan(null)}
              className="rounded-md px-2 py-1 text-white/60 hover:bg-white/10"
            >
              {tt("common.cancel")}
            </button>
          </div>
        </div>
      )}
      {review && <div data-testid="hermes-review" className="mx-7 mt-2 rounded-md border border-white/15 px-3 py-2 text-xs">
        <div>{tt("cmdbar.hermesReview")}</div><p className="whitespace-pre-wrap">{review.text}</p>
        <p>{tt("cmdbar.hermesSelection", { n: review.selections.length })}{review.selections.length > 0 ? ` · ${[...new Set(review.selections.map(s => tt(`cmdbar.hermesKind.${s.kind}`)))].join(", ")}` : ""}</p>
        <p className="py-1 text-white/60">{tt("cmdbar.hermesNotice")}</p>
        <button data-testid="hermes-send" disabled={busy} onClick={() => void send()} className="rounded-md bg-white/15 px-3 py-1 disabled:opacity-50">{tt("cmdbar.hermesSend")}</button>
      </div>}
      {active.current && <button data-testid="hermes-stop" onClick={stop} className="mx-7 mt-1 rounded-md bg-white/10 px-3 py-1 text-xs">{tt("cmdbar.hermesStop")}</button>}
      {reply && <div data-testid="hermes-reply" className="px-7 pt-2 text-xs"><div className="text-white/50">{reply.request}</div><p className="whitespace-pre-wrap">{reply.text}</p></div>}
      {status && <div role="status" className="px-7 pt-1 text-xs text-white/55">{status}</div>}
      {error && <div role="alert" className="px-7 pt-1 text-xs text-red-300">{error}
        {failure && <details><summary>{tt("cmdbar.hermesDetails")}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(failure, null, 2)}</pre></details>}
      </div>}
      {!plan && !review && !reply && !status && !error && !showSettings && (
        <div className="px-7 pt-1 text-[11px] text-white/30">
          {tt("cmdbar.hint")}
        </div>
      )}
    </div>
  );
}
