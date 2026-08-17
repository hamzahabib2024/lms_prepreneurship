import { Icon } from "./Icon";

/**
 * A lecture's thumbnail — drawn, not fetched.
 *
 * WHY NOT THE REAL FRAME. Drive does return a `thumbnailLink` for every video,
 * and it is tempting. Three reasons it is not used:
 *
 *   ARC-041. Those links point at googleusercontent.com and identify the file.
 *   Putting one in the markup of a student's page is a storage reference
 *   reaching a student by another name.
 *
 *   They expire, and they expire quietly. A page rendered from a list fetched
 *   two minutes ago shows a grid of broken images — the single worst-looking
 *   failure a catalogue can have, and one that says "this system is neglected"
 *   far louder than no picture at all.
 *
 *   The first frame of a Meet recording is somebody's empty meeting room, or a
 *   black screen while the teacher finds the share button. It is not a useful
 *   picture of the class.
 *
 * So each recording gets deterministic artwork from its own title, the same
 * approach and the same reasoning as CourseCover: no files, nothing to host,
 * nothing to expire, and a recording synced this morning has a thumbnail this
 * morning. Two lectures called different things look different; the same
 * lecture looks the same everywhere it appears.
 */

/** Stable small hash — same string, same number, on every machine. */
function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Twelve hues at 30% lightness — the same measured value CourseCover settled
 * on, where white text clears 4.5:1 on every one of them (NFR-ACC-003). A hue
 * chosen freely eventually lands on a yellow that does not.
 */
const HUES = [212, 258, 292, 330, 8, 24, 44, 96, 152, 172, 190, 236];

export function LectureThumb({
  title,
  durationSeconds,
  watchedPercent = 0,
  size = "card",
}: {
  title: string;
  durationSeconds: number | null;
  watchedPercent?: number;
  /** "card" in a grid, "row" beside a line of text in the queue. */
  size?: "card" | "row";
}) {
  const hash = hashOf(title);
  const hue = HUES[hash % HUES.length]!;
  const tilt = (hash >> 3) % 40;

  return (
    <span className={`lecture-thumb lecture-thumb-${size}`} aria-hidden="true">
      <span
        className="lecture-thumb-art"
        style={{
          background: `linear-gradient(${120 + tilt}deg, hsl(${hue} 62% 30%), hsl(${
            (hue + 38) % 360
          } 58% 22%))`,
        }}
      >
        <Icon name="play" className="lecture-thumb-play" />
      </span>

      {/* Duration where every video service in the world puts it. Absent
          rather than "0:00" when the provider could not tell us: local storage
          does no media probing, and a wrong number is worse than none. */}
      {durationSeconds ? (
        <span className="lecture-thumb-time">{formatDuration(durationSeconds)}</span>
      ) : null}

      {/* The red line under a video somebody has started. Only when there is
          genuinely something to resume — a 1% bar on a lecture that was opened
          and closed is noise. */}
      {watchedPercent >= 2 && (
        <span className="lecture-thumb-progress">
          <span style={{ width: `${Math.min(100, watchedPercent)}%` }} />
        </span>
      )}
    </span>
  );
}

/** "1:12:11" or "8:03" — hours only when there are any, as a player writes it. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
