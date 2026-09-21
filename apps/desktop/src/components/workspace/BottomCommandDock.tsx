// UX-1 bottom dock: floating command bar (same parser/providers/path)
// with the intent suggestions docked above it — never over the model.
// No microphone: no speech-to-text exists, so none is shown.
import { CommandBar } from "../CommandBar";
import { SuggestionBar } from "../SuggestionBar";

export function BottomCommandDock() {
  return (
    <div
      className="pointer-events-auto flex w-full max-w-2xl flex-col items-stretch gap-2"
      data-testid="command-dock"
    >
      <SuggestionBar />
      <div className="kreoda-float w-full px-3 py-2">
        <CommandBar />
      </div>
    </div>
  );
}
