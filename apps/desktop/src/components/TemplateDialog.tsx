import { useState } from "react";
import { executeCommand } from "../commands/execute";
import { runPlan } from "../intent/provider";
import { useSelectionStore } from "../stores";
import { useT } from "../i18n";

type TemplateId = "plate" | "openBox" | "cylinder";

/**
 * Starter models are ordinary command sequences: the same CreateBox /
 * CreateHolesCorners / CreateShell / CreateCylinder path as manual editing.
 * Nothing here is a hidden mesh or a locked template.
 */
export function TemplateDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const tt = useT();
  const [busy, setBusy] = useState<TemplateId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createPlate = async (): Promise<void> => {
    const box = await executeCommand("CreateBox", {
      widthMm: 100,
      heightMm: 60,
      depthMm: 10,
    });
    if (box.kind !== "created") throw new Error(tt("tpl.failed"));
    useSelectionStore.getState().select(box.feature.featureId, false);
    await runPlan({
      steps: [
        {
          command: "CreateHolesCorners",
          params: {
            diameterMm: 6,
            count: 4,
            insetMm: 8,
            depthMode: "throughAll",
            depthMm: 0,
          },
        },
      ],
      source: "local",
      text: "template: plate",
    });
  };

  const createOpenBox = async (): Promise<void> => {
    const box = await executeCommand("CreateBox", {
      widthMm: 80,
      heightMm: 60,
      depthMm: 30,
    });
    if (box.kind !== "created") throw new Error(tt("tpl.failed"));
    const face = `${box.feature.featureId}:box.+Z`;
    useSelectionStore.getState().select(face, false);
    await executeCommand("CreateShell", {
      targetId: box.feature.featureId,
      faceRole: face,
      thicknessMm: 2,
    });
  };

  const createCylinder = async (): Promise<void> => {
    const created = await executeCommand("CreateCylinder", {
      radiusMm: 30,
      heightMm: 60,
    });
    if (created.kind !== "created") throw new Error(tt("tpl.failed"));
  };

  const run = async (id: TemplateId): Promise<void> => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      if (id === "plate") await createPlate();
      else if (id === "openBox") await createOpenBox();
      else await createCylinder();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tt("tpl.failed"));
    } finally {
      setBusy(null);
    }
  };

  const options: { id: TemplateId; title: string; desc: string }[] = [
    { id: "plate", title: tt("tpl.plate"), desc: tt("tpl.plateDesc") },
    { id: "openBox", title: tt("tpl.openBox"), desc: tt("tpl.openBoxDesc") },
    { id: "cylinder", title: tt("tpl.cylinder"), desc: tt("tpl.cylinderDesc") },
  ];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      data-testid="template-dialog"
    >
      <div className="w-[30rem] max-w-[92vw] rounded-xl border border-white/15 bg-[var(--kreoda-float-elevated-bg)] p-5 shadow-2xl">
        <h2 className="text-sm font-semibold">{tt("tpl.title")}</h2>
        <p className="pb-3 pt-1 text-xs text-white/55">{tt("tpl.desc")}</p>
        <div className="grid gap-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-testid={`template-${option.id}`}
              disabled={busy !== null}
              onClick={() => void run(option.id)}
              className="rounded-lg border border-white/10 bg-white/5 p-3 text-left transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <span className="block text-sm font-semibold text-white">
                {busy === option.id ? tt("tpl.creating") : option.title}
              </span>
              <span className="mt-0.5 block text-xs text-white/50">{option.desc}</span>
            </button>
          ))}
        </div>
        {error && <div role="alert" className="pt-2 text-xs text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-50"
          >
            {tt("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
