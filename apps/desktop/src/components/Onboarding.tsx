import { useState } from "react";
import { Box, Cylinder, Pencil } from "lucide-react";
import { executeCommand } from "../commands/execute";

const HIDE_KEY = "kreoda.onboardingHidden";
const HINT_KEY = "kreoda.hintPullLearned";

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) !== "1";
  } catch {
    return true;
  }
}

function hideOnboarding(): void {
  try {
    localStorage.setItem(HIDE_KEY, "1");
  } catch {
    // Best-effort.
  }
}

export function pullHintLearned(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPullLearned(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Best-effort.
  }
}

/** First-time-use workflow (§56): no mandatory tutorial, just entry points. */
export function Onboarding({
  onSketch,
  onDone,
}: {
  onSketch: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createPrimitive = async (kind: "box" | "cylinder"): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "box") {
        await executeCommand("CreateBox", {
          widthMm: 100,
          heightMm: 50,
          depthMm: 20,
        });
      } else {
        await executeCommand("CreateCylinder", {
          radiusMm: 20,
          heightMm: 60,
        });
      }
      hideOnboarding();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "creation failed");
    } finally {
      setBusy(null);
    }
  };

  const start = (
    <div className="pointer-events-auto w-80 rounded-xl border border-white/15 bg-[#141922]/95 p-5 shadow-2xl" data-testid="onboarding">
      <div className="pb-1 text-base font-semibold">
        What do you want to create?
      </div>
      <div className="pb-4 text-xs text-white/55">
        Exact solids from the first click — no CAD vocabulary needed.
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={() => void createPrimitive("box")}
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-left text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          <Box size={16} /> Start from a box
        </button>
        <button
          onClick={() => void createPrimitive("cylinder")}
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 disabled:opacity-50"
        >
          <Cylinder size={16} /> Start from a cylinder
        </button>
        <button
          onClick={() => {
            hideOnboarding();
            onSketch();
          }}
          className="flex items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
        >
          <Pencil size={16} /> Draw a shape
        </button>
      </div>
      <button
        onClick={() => {
          hideOnboarding();
          onDone();
        }}
        className="pt-3 text-xs text-white/45 hover:text-white/70"
      >
        Dismiss
      </button>
      {error && <div className="pt-2 text-xs text-red-300">{error}</div>}
    </div>
  );

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {start}
    </div>
  );
}

/** Contextual coaching hint (dismissed once learned, stored locally). */
export function CoachingHint({ text }: { text: string }) {
  const [visible, setVisible] = useState(() => !pullHintLearned());
  if (!visible) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[116px] flex -translate-x-1/2 items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white/80">
      <span>{text}</span>
      <button
        onClick={() => {
          markPullLearned();
          setVisible(false);
        }}
        className="text-white/50 hover:text-white"
      >
        Got it
      </button>
    </div>
  );
}
