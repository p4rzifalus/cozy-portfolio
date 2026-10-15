import { ReactNode } from "react";

// Keycap like in Dishonored: dark metal key with a cut corner. Hidden on touch screens (overlay.css).
// k = "Esc", "↵", "Tab", "1"… or "mouse" / "drag" (left mouse button).
export function Kbd({ k }: { k: string }) {
  if (k === "mouse" || k === "drag")
    return (
      <kbd className="kbd mouse" aria-label={k === "mouse" ? "клик" : "перетащить"}>
        <svg viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="3" y="2" width="10" height="16" rx="5" />
          <path d="M8 2v6M3 8h10" />
          <path d="M3.5 3.5 Q4 2.4 8 2v6H3z" fill="currentColor" stroke="none" opacity="0.85" />
        </svg>
      </kbd>
    );
  return <kbd className={"kbd" + (k.length > 2 ? " wide" : "")}>{k}</kbd>;
}

// "[Esc] Назад": keycap + handwritten caption. A button, so it also works by click / on phones.
export function Hint({ k, children, onClick, className = "" }: { k: string; children: ReactNode; onClick?: () => void; className?: string }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag className={"hint " + className} onClick={onClick}>
      <Kbd k={k} />
      <em>{children}</em>
    </Tag>
  );
}
