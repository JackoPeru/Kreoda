import { useMemo } from "react";
import { useDocumentUiStore } from "../../stores";
import { useSharedTargetStore, visibleSharedTargets } from "../../model/shared-targets";
import { useT } from "../../i18n";

export function SharedTargetChip() {
  const events = useSharedTargetStore(state => state.events);
  const context = useSharedTargetStore(state => state.context);
  const meshes = useDocumentUiStore(state => state.meshes);
  const meshRevision = useDocumentUiStore(state => state.meshRevision);
  const documentId = useDocumentUiStore(state => state.documentId);
  const revision = useDocumentUiStore(state => state.revision);
  const targets = useMemo(() => visibleSharedTargets(meshes, { documentId, revision }),
    [events, context, meshes, meshRevision, documentId, revision]);
  const t = useT();
  if (targets.length === 0) return null;
  return <div className="pointer-events-none absolute right-3 top-16 z-20 max-w-[260px] rounded-lg border border-teal-300/25 bg-slate-950/85 px-3 py-2 text-xs text-teal-200"
    data-testid="shared-target-chip" role="status" aria-label={t("chrome.sharedTarget")}>
    <span className="block text-[10px] uppercase tracking-wide">{t("chrome.sharedTarget")}</span>
    {targets.map(target => <span key={target.clientId} className="block truncate" title={target.ids.join(", ")}>
      {target.ids.join(", ")}
    </span>)}
  </div>;
}
