/**
 * A small set of line icons for the navigation.
 *
 * DRAWN HERE RATHER THAN INSTALLED. An icon library is 40kB and a build-time
 * dependency for eighteen shapes, and this app deliberately has no CSS
 * framework for the same reason: what is written down can be checked.
 *
 * They are decorative. Every navigation item carries its own text label, so
 * these are `aria-hidden` — an icon announced alongside the word it duplicates
 * is a screen reader saying everything twice (NFR-ACC-005).
 */

const PATHS: Record<string, string> = {
  dashboard: "M3 12h7V3H3v9Zm0 9h7v-7H3v7Zm11 0h7V12h-7v9Zm0-18v7h7V3h-7Z",
  book: "M4 19.5V5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2V6M9 7h7M9 11h7",
  users: "M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75",
  calendar: "M3 9h18M7 3v3m10-3v3M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
  check: "M9 11.5 11.5 14 15 9.5M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  pen: "m14 4 6 6L9 21H3v-6L14 4ZM12.5 5.5l6 6",
  money: "M12 6v12M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5S10.3 12 12 12s3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5",
  chart: "M4 20V10M10 20V4m6 16v-7m6 7V8M2 20h20",
  award: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM8.5 13 7 21l5-2.5L17 21l-1.5-8",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1ZM15 8a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14",
  chat: "M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  database: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3ZM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  upload: "M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  clipboard:
    "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1ZM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  layers: "m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu: "M3 6h18M3 12h18M3 18h18",
  play: "M8 5.5v13l11-6.5-11-6.5Z",

  /*
   * The four platforms the Institute posts on.
   *
   * DRAWN AS RECOGNISABLE SHAPES, not copied logos. A brand mark is somebody
   * else's trademark with its own usage rules about colour, spacing and
   * distortion, and shipping a traced copy in a stylesheet breaks all three.
   * These read as "video", "camera", "the letter f" at the size they are used,
   * which is what a person scanning a footer needs, and each carries a text
   * label for a screen reader either way.
   */
  youtube: "M2.5 8.2a3 3 0 0 1 2.6-2.6C7.4 5.3 12 5.3 12 5.3s4.6 0 6.9.3a3 3 0 0 1 2.6 2.6c.3 2.5.3 5.1 0 7.6a3 3 0 0 1-2.6 2.6c-2.3.3-6.9.3-6.9.3s-4.6 0-6.9-.3a3 3 0 0 1-2.6-2.6c-.3-2.5-.3-5.1 0-7.6ZM10 9.5v5l4.5-2.5L10 9.5Z",
  tiktok: "M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5c.35 0 .69.05 1 .15M14 3c.4 2.4 2.2 4.2 4.6 4.6M14 3h.2",
  facebook: "M14 8.5V7a1.5 1.5 0 0 1 1.5-1.5H17V3h-2.2A3.8 3.8 0 0 0 11 6.8v1.7H9V11h2v10h3V11h2.2l.5-2.5H14Z",
  instagram:
    "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM17 6.6h.01",
  "chevron-left": "m15 5-7 7 7 7",
  "chevron-right": "m9 5 7 7-7 7",
  alert: "M12 8v5M12 16.5h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",

  /* Added with the shell: search, the sidebar rail, and the account menu. */
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  /* A bare tick. `check` is the register's boxed one and reads as a checkbox. */
  tick: "m5 13 4 4L19 7",
  panel: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM9 4v16",
  key: "M14.5 10.5a4 4 0 1 0-4.9 3.9L4 20v0h3v-2h2v-2h1.6a4 4 0 0 0 3.9-5.5ZM16.5 7.5h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  monitor: "M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 20h8m-4-4v4",

  /* Added with the certificate: the four things a person does with a document
     they have just been given, plus the link they send to an employer. */
  download: "M12 4v12m0 0 4-4m-4 4-4-4M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM3 16l5-4 4 3 3-2.5L21 17",
  print: "M7 9V4h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 15h10v6H7v-6Z",
  link: "M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.4 1.4M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4",
};

/**
 * Every name in PATHS, for the guard that proves the app only uses these.
 *
 * `IconName` is the same fact as a TYPE, and it is the stronger of the two.
 * The guard reads icon names out of .tsx files with a regex over the JSX,
 * which cannot see a name held in a data structure — and the navigation is now
 * exactly that. A destination naming an icon nobody drew becomes a compile
 * error rather than a four-square grid where a chevron should be.
 *
 * (The first version of this comment quoted the JSX it describes, and the
 * guard duly failed the build on the example. Left as a note that the regex
 * does not strip comments.)
 */
export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, className }: { name: string; className?: string }) {
  // A missing name falls back to a shape rather than crashing, which is right
  // — but it is SILENT, so a typo renders a dashboard grid where a chevron
  // should be and nothing anywhere says so. icon-names.spec.ts fails the build
  // if any page asks for a name this file does not define.
  const d = PATHS[name] ?? PATHS["dashboard"]!;
  return (
    <svg
      viewBox="0 0 24 24"
      /*
       * A SIZE, SO A CALLER THAT FORGETS ONE GETS AN ICON RATHER THAN A POSTER.
       *
       * An SVG with a viewBox and no width or height fills whatever box it is
       * in. Every existing use of this component sets a size in CSS, so the
       * omission was invisible — until a new one did not, and rendered a
       * folder glyph EIGHT HUNDRED PIXELS TALL down a list of twelve rows.
       * There is no global `.btn svg` rule to catch it either, so the same
       * mistake was waiting in every button an icon is ever put inside.
       *
       * These are PRESENTATION ATTRIBUTES, which lose to any CSS rule — so the
       * forty places that already say `width: 17px` are untouched, and this is
       * only what happens when nothing else has an opinion.
       */
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}
