// Shared click-away backdrop for floating menus/popovers. One definition
// (z-40) so every popover stacks the same way: below docks/dialogs,
// above the viewport and drawers. Must render OUTSIDE any blurred
// container — backdrop-filter would trap `fixed` positioning.
export function DismissBackdrop({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      onClick={onClose}
      className="pointer-events-auto fixed inset-0 z-40 cursor-default bg-transparent"
      tabIndex={-1}
    />
  );
}
