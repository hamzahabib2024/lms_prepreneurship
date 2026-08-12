import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * The small pieces every screen needs and twenty-four of them were doing by
 * hand — or not at all.
 */

/**
 * A loading placeholder shaped like the thing that is coming.
 *
 * Twenty-four screens said "Loading…" in grey. The word is honest but it
 * throws the layout away and then rebuilds it, so the page jumps the moment
 * data arrives and the reader loses their place. A block the shape of the
 * content holds the space.
 *
 * It is `aria-hidden` and paired with a live region: a screen reader should
 * hear "Loading" once, not a description of eight grey rectangles.
 */
export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <>
      <span className="visually-hidden" role="status">
        Loading
      </span>
      <div className={`skeleton-group ${className}`} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
        ))}
      </div>
    </>
  );
}

/** A page's worth of them, for a first load. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card">
          <Skeleton lines={3} />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing here — and WHY.
 *
 * NFR-USE-009. "No records" reads as a fault; a newly admitted student seeing
 * an empty subject list before term starts should be told that is expected.
 * The action is optional because sometimes there genuinely is nothing to do
 * but wait, and a button that leads nowhere is worse than none.
 */
export function EmptyState({
  icon = "layers",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action && <div className="row-actions">{action}</div>}
    </div>
  );
}

/**
 * Progress as a ring.
 *
 * THE NUMBER IS IN THE MIDDLE, and that is the point: a ring on its own is a
 * shape somebody has to estimate, and this figure decides whether a student
 * gets a certificate. The ring is the ornament; the number is the answer.
 *
 * `role="img"` with a label, because a screen reader given two SVG circles
 * says nothing useful (NFR-ACC-005).
 */
export function ProgressRing({
  percent,
  size = 84,
  label,
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const stroke = size < 60 ? 6 : 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      className="ring"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${safe}% complete`}
    >
      {/* The ring draws the number that is already printed beside it, so a
          screen reader announcing "graphic" here would be reading the same
          fact twice (NFR-ACC-005). */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="ring-value"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - safe / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-label">{Math.round(safe)}%</span>
    </div>
  );
}
