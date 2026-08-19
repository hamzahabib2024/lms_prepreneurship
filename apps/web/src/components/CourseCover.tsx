import { Icon } from "./Icon";

/**
 * Cover art for a course, drawn rather than photographed.
 *
 * WHY NOT PICTURES. A stock photograph of somebody pointing at a laptop tells a
 * visitor nothing and makes them doubt the rest of the page; real photographs
 * of every course would have to be commissioned, hosted, kept in step as
 * courses change, and would break one at a time as links rot. So each course
 * gets a deterministic piece of artwork instead: no files, nothing to host,
 * nothing to go missing, and a course added on a Tuesday has a cover the same
 * afternoon.
 *
 * DETERMINISTIC, which is the part that makes it work. The hue comes from the
 * course's own code, so Graphic Designing is the same green everywhere it
 * appears — the landing page, the apply form, the student's subject list — and
 * a person learns the colour without being told. Random colours per render
 * would be worse than none.
 *
 * A REAL PICTURE WINS. Subject and Programme both carry thumbnailUrl; when the
 * Institute sets one, that is shown instead. This is the fallback for the
 * ninety per cent of courses that will never have one, not a replacement for
 * photography the Institute actually has.
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
 * SIX TONES OF NAVY, NOT TWELVE HUES AROUND THE WHEEL.
 *
 * This was [212, 258, 292, 330, 8, 24, 44, 96, 152, 172, 190, 236] — a full
 * rainbow, and §3.2 of the brand guidelines forbids precisely that: "Never use
 * bright generic blues, purples, teals, or rainbow gradients."
 *
 * WHAT IS LOST, SAID PLAINLY. A course no longer has its own colour, so
 * "Graphic Designing is the green one" stops being true. That was a real
 * affordance and it is worth naming rather than pretending the replacement is
 * strictly better.
 *
 * WHAT REPLACES IT is the part of the old system that did the most work
 * anyway: FOUR PATTERNS at a per-course rotation, now paired with six navy
 * tones and an amber accent, which still gives twenty-four visibly distinct
 * covers. And it survives a reader who could not tell the twelve hues apart —
 * a pattern is legible to a person with any kind of colour vision, which the
 * rainbow was not.
 *
 * The band is 198–218 degrees: every value is recognisably the brand navy
 * (#1a3c5e is hue 209), varied only enough that two courses side by side do
 * not read as the same tile.
 */
const HUES = [198, 203, 209, 212, 215, 218];

const SHAPES = ["arcs", "grid", "waves", "orbit"] as const;

/** An icon that suits the subject, where the name says something. */
function iconFor(name: string): string {
  const n = name.toLowerCase();
  if (/(design|graphic|brand)/.test(n)) return "pen";
  if (/(market|seo|commerce|e-comm|sales)/.test(n)) return "megaphone";
  if (/(web|develop|program|code|engineer)/.test(n)) return "layers";
  if (/(video|edit|motion|film)/.test(n)) return "play";
  if (/(ai|automat|agent|data|analy)/.test(n)) return "chart";
  if (/(quran|hifz|nizami|islam)/.test(n)) return "book";
  if (/(finance|account|money)/.test(n)) return "money";
  return "book";
}

export function CourseCover({
  code,
  name,
  thumbnailUrl,
  size = "card",
}: {
  code: string;
  name: string;
  thumbnailUrl?: string | null;
  /** `card` fills a card's head; `chip` is the small square beside a title. */
  size?: "card" | "chip";
}) {
  if (thumbnailUrl) {
    return (
      <div className={`cover cover-${size} cover-photo`}>
        {/* Alt is empty on purpose: the course name is written beside this in
            every place it is used, and repeating it is a screen reader saying
            everything twice (NFR-ACC-005). */}
        <img src={thumbnailUrl} alt="" loading="lazy" />
      </div>
    );
  }

  const h = hashOf(code || name);
  const hue = HUES[h % HUES.length]!;
  const shape = SHAPES[(h >> 4) % SHAPES.length]!;
  const rotate = (h >> 8) % 40;
  // The depth of the navy, as a second axis. Six tones times four patterns
  // times two depths is enough that a page of courses does not look tiled.
  const deep = (h >> 12) % 2 === 0 ? 26 : 21;

  return (
    <div
      className={`cover cover-${size} cover-${shape}`}
      style={
        {
          "--cover-hue": hue,
          "--cover-lift": `${deep}%`,
          "--cover-turn": `${rotate}deg`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <span className="cover-mark">
        <Icon name={iconFor(name)} />
      </span>
      {size === "card" && <span className="cover-code">{code}</span>}
    </div>
  );
}
