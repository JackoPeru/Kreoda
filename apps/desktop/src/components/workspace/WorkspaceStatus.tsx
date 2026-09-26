// UX-4 diagnostics: revision/mesh/core details live behind the status
// pill (one click), not in a permanent footer. Only connectivity stays
// visible — it requires user action when the engine is offline.
import { useState } from "react";
import { useDocumentUiStore } from "../../stores";
import { useT } from "../../i18n";
import { DismissBackdrop } from "./DismissBackdrop";

export function WorkspaceStatus({
  updateVersion,
}: {
  updateVersion: string | null;
}) {
  const coreRunning = useDocumentUiStore((s) => s.coreRunning);
  const coreVersion = useDocumentUiStore((s) => s.coreVersion);
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <div className="pointer-events-auto relative" data-testid="workspace-status">
      {open && <DiagnosticsPopover updateVersion={updateVersion} />}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={t("status.title")}
        className="flex items-center gap-2 rounded-[var(--kreoda-radius-sm)] bg-black/60 px-2.5 py-1.5 text-[11px] text-white/55 backdrop-blur-[var(--kreoda-surface-blur)] hover:bg-white/10 hover:text-white"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${coreRunning ? "bg-emerald-400" : "bg-red-400"}`}
          title={coreRunning ? t("status.engineOn") : t("status.engineOff")}
        />
        {coreRunning ? t("status.coreOn", { v: coreVersion ?? "" }) : t("status.coreOff")}
        {updateVersion && (
          <span
            className="text-amber-200/80"
            title={t("status.updateTitle")}
            data-testid="update-note"
          >
            {t("status.updateReady", { v: updateVersion })}
          </span>
        )}
      </button>
      {open && (
        <DismissBackdrop onClose={() => setOpen(false)} label={t("status.closeDiagnostics")} />
      )}
    </div>
  );
}

function DiagnosticsPopover({
  updateVersion,
}: {
  updateVersion: string | null;
}) {
  const documentId = useDocumentUiStore((s) => s.documentId);
  const revision = useDocumentUiStore((s) => s.revision);
  const features = useDocumentUiStore((s) => s.features);
  const sketches = useDocumentUiStore((s) => s.sketches);
  const meshes = useDocumentUiStore((s) => s.meshes);
  const coreRunning = useDocumentUiStore((s) => s.coreRunning);
  const coreVersion = useDocumentUiStore((s) => s.coreVersion);
  const t = useT();

  return (
    <div
      className="kreoda-float-elevated absolute bottom-full left-0 z-50 mb-2 w-64 p-3 font-mono text-[11px] leading-relaxed text-white/70"
      data-testid="workspace-diagnostics"
      role="status"
    >
      <div className="pb-1 font-sans text-[11px] uppercase tracking-wide text-white/45">
        {t("common.diagnostics")}
      </div>
      <div>{t("status.doc", { id: documentId })}</div>
      <div>{t("status.rev", { n: revision })}</div>
      <div>
        {t("status.counts", { f: features.length, s: sketches.length, m: Object.keys(meshes).length })}
      </div>
      <div>{coreRunning ? t("status.coreOn", { v: coreVersion ?? "" }) : t("status.coreOff")}</div>
      {updateVersion && <div>{t("status.updateLine", { v: updateVersion })}</div>}
    </div>
  );
}

/** Bottom-right help: real short-command cheat sheet, nothing else. */
export function WorkspaceHelp() {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <div className="pointer-events-auto relative" data-testid="workspace-help">
      {open && (
        <div className="kreoda-float-elevated absolute bottom-full right-0 z-50 mb-2 w-80 p-3 text-xs leading-relaxed text-white/75">
          {t("parse.help")}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("status.helpAria")}
        aria-expanded={open}
        title={t("status.helpTitle")}
        className="rounded-[var(--kreoda-radius-sm)] bg-black/60 px-2.5 py-1.5 text-xs text-white/70 backdrop-blur-[var(--kreoda-surface-blur)] hover:bg-white/10 hover:text-white"
      >
        ?
      </button>
      {open && (
        <DismissBackdrop onClose={() => setOpen(false)} label={t("status.closeHelp")} />
      )}
    </div>
  );
}
