/**
 * Turning an unknown value into text WITHOUT ever producing "[object Object]".
 *
 * Every screen here renders values that arrive typed as `unknown`: a report
 * cell, an audit log's before/after, a quiz answer, a setting. `String(x)` on
 * an object gives "[object Object]", which on a report or an audit entry is a
 * value somebody has to go to the database to recover.
 *
 * An object is rendered as its JSON instead — long, but true, and a reader can
 * see what it was.
 */
export function text(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value || fallback;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    // A circular structure. Saying so beats throwing inside a render.
    return fallback || "(unreadable)";
  }
}
