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

/**
 * A LIST'S WORTH, for the screens that render rows rather than cards.
 *
 * The shape has to match what is coming or the placeholder is just a
 * differently-shaped jump: a card grid skeleton in front of an incoming table
 * moves the layout twice instead of once.
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <>
      <span className="visually-hidden" role="status">
        Loading
      </span>
      <div className="card" aria-hidden="true">
        <ul className="list skeleton-list">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i}>
              <span className="skeleton" style={{ width: `${58 - (i % 3) * 9}%` }} />
              <span className="skeleton skeleton-trail" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * A TABLE'S WORTH — header band and rows, at the column count the real table
 * will have, so the header does not jump sideways when the data lands.
 */
export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <>
      <span className="visually-hidden" role="status">
        Loading
      </span>
      <div className="table-scroll skeleton-table" aria-hidden="true">
        <div className="skeleton-thead">
          {Array.from({ length: columns }, (_, c) => (
            <span key={c} className="skeleton" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div className="skeleton-tr" key={r}>
            {Array.from({ length: columns }, (_, c) => (
              <span
                key={c}
                className="skeleton"
                style={{ width: c === 0 ? "70%" : `${40 + ((r + c) % 4) * 12}%` }}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * A PAGE'S WORTH — the heading band plus whatever is under it.
 *
 * Used where the whole screen is waiting, so the title does not appear a
 * beat before the content and shift it.
 */
export function SkeletonPage({ children }: { children?: ReactNode }) {
  return (
    <>
      <span className="visually-hidden" role="status">
        Loading
      </span>
      <div className="skeleton-head" aria-hidden="true">
        <span className="skeleton" />
      </div>
      {children ?? <SkeletonCards count={3} />}
    </>
  );
}

/**
 * SOMETHING WENT WRONG, AND WHAT TO DO ABOUT IT.
 *
 * The thirty-eight error banners across these pages already say the right
 * thing — they surface the server's own message rather than inventing one,
 * and they carry `role="alert"` so a screen reader speaks them. What none of
 * them offered was a way to try again, so a network blip meant reloading the
 * whole application to get back to a screen that was one fetch away.
 *
 * `onRetry` is optional because some failures are not retryable — a 403 will
 * be a 403 next time, and a button that fails identically twice teaches
 * people to distrust every button.
 */
export function ErrorState({
  title = "That did not load",
  message,
  onRetry,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="alert alert-error" role="alert">
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {onRetry && (
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * THE SECOND QUESTION: hide it, or erase it?
 *
 * Asked after the first confirmation rather than offered as its own button.
 * A row carrying both Delete and Erase is a row where the irreversible one
 * sits a few pixels from the safe one, and the two do not deserve equal
 * prominence.
 *
 * CANCEL STILL DELETES, and the wording says so in as many words. A Cancel
 * that silently abandoned the whole operation would teach people to press OK
 * to be safe, which is precisely backwards when OK is the permanent one.
 */
export function askPermanent(what: string): boolean {
  return window.confirm(
    `Erase ${what} permanently?\n\n` +
      `OK — the record is removed from the database for good. This cannot be undone.\n\n` +
      `Cancel — it is still deleted and leaves every list, but can be restored later.`,
  );
}
