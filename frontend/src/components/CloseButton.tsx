import type { MouseEvent, PointerEvent } from "react";

export type CloseButtonProps = {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  title?: string;
  className?: string;
};

export function CloseButton({
  onClick,
  onPointerDown,
  ariaLabel = "Close",
  title = "Close",
  className = "",
}: CloseButtonProps) {
  return (
    <button
      type="button"
      className={`closeButton ${className}`.trim()}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label={ariaLabel}
      title={title}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
