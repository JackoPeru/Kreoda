import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/**
 * One shared Radix shell for the small CAD dialogs (same overlay/size).
 * Footers stay per-dialog (rendered raw) so layouts never shift.
 */
export function CadDialog({
  title,
  description,
  onClose,
  error,
  actions,
  testId,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  error?: string | null;
  actions?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/3 z-[70] w-80 -translate-x-1/2 rounded-lg border border-white/15 bg-[#141922] p-4"
          {...(testId ? { "data-testid": testId } : {})}
        >
          <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
          {description !== undefined && (
            <Dialog.Description className="pb-3 text-xs text-white/55">
              {description}
            </Dialog.Description>
          )}
          {children}
          {error && <div className="pb-2 text-xs text-red-300">{error}</div>}
          {actions}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The standard Cancel + primary footer used by most dialogs. */
export function CadActions({
  onClose,
  onSubmit,
  busy,
  busyLabel,
  label,
  disabled,
}: {
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  busyLabel: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        onClick={onClose}
        className="rounded-md px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={busy || disabled}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}
