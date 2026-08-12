/**
 * Accessibility, as far as a static check can take it — NFR-ACC-001..009.
 *
 * WHAT THIS CANNOT DO, said first so nobody reads a green run as an audit:
 * it cannot tell you whether a screen makes sense read aloud, whether the
 * reading order matches the visual order, whether a live region announces at
 * the right moment, or whether anything is usable by keyboard alone. Those need
 * a person with a screen reader, and that has not happened.
 *
 * What it does is catch the failures that are mechanical, and that have
 * actually occurred in this codebase: an input with no label, a button whose
 * only content is an icon, an image with no alt text, a colour used as the sole
 * carrier of meaning, and a click handler on something that cannot be focused.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WEB = join(__dirname, "..", "..", "..", "..", "apps", "web", "src");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const files = tsxFiles(WEB).map((path) => ({
  name: relative(WEB, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));

/**
 * Strips comments, so an example in prose is not read as markup — and blanks
 * the `>` in an arrow function.
 *
 * That second part is not cosmetic. Every attribute pattern below reads up to
 * the first `>`, and `onChange={(e) => ...}` puts one in the middle of the tag.
 * Without this the scan sees `<input type="date" value={x} onChange={(e) =` as
 * a whole element, misses any aria-label after it, and reports a properly
 * labelled field as a violation. The first run of this check did exactly that
 * for five files, all of which were correct.
 */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/=>/g, "=»");

describe("the check itself", () => {
  it("found the screens", () => {
    // Without this, a path change makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(30);
  });
});

describe("every control can be named by a screen reader (NFR-ACC-002)", () => {
  /*
   * THERE IS NO INPUT-LABELLING CHECK HERE, and its absence is the finding.
   *
   * Two were written and both were wrong. Counting unclosed <label> tags
   * accused five files whose controls sat correctly inside
   * `<label className="field"><span>Name</span><input/></label>`. Looking for
   * a <label> within the preceding 200 characters accused eight, because a
   * label with a hint and a few attributes is longer than that.
   *
   * The honest conclusion is that deciding whether a control has an accessible
   * name needs the rendered accessibility tree, not a regex over JSX — and the
   * cost of guessing is an exception list that turns a real check into a
   * rubber stamp. This is one of the things the screen-reader audit has to
   * cover, and it is listed as outstanding rather than papered over with a
   * green tick that means nothing.
   */


  it.each(files.map((f) => f.name))("%s gives every icon-only button a name", (name) => {
    const source = code(files.find((f) => f.name === name)!.source);
    const offenders: string[] = [];

    for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]{0,120}?)<\/button>/g)) {
      const attrs = match[1] ?? "";
      const inner = match[2] ?? "";
      if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
      // Any text at all, or an interpolation that yields text, is a name.
      const stripped = inner.replace(/<[^>]+>/g, "").trim();
      if (stripped.length > 0) continue;
      offenders.push(match[0].replace(/\s+/g, " ").slice(0, 80));
    }

    expect(offenders).toEqual([]);
  });
});

describe("meaning never rests on colour alone (NFR-ACC-007)", () => {
  it("pairs every status pill with a word", () => {
    // The rule the design system states and the one easiest to break: a
    // `pill-warn` with no text is a coloured dot, and to a colour-blind reader
    // it is the same dot as `pill-ok`.
    const offenders: string[] = [];
    for (const { name, source } of files) {
      for (const match of code(source).matchAll(
        /<span className=(?:"|\{`)[^"`]*pill[^"`]*(?:"|`\})>([\s\S]{0,80}?)<\/span>/g,
      )) {
        const inner = (match[1] ?? "").replace(/<[^>]+>/g, "").trim();
        if (inner.length === 0) offenders.push(`${name}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("images and icons", () => {
  it("gives every <img> alt text, even if empty for decoration", () => {
    const offenders: string[] = [];
    for (const { name, source } of files) {
      for (const match of code(source).matchAll(/<img\b([^>]*)>/g)) {
        if (!/alt=/.test(match[1] ?? "")) offenders.push(`${name}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("hides decorative SVG from the reading order", () => {
    // Icon.tsx is aria-hidden by construction; this catches an inline <svg>
    // added later without it, which a screen reader would otherwise announce
    // as "graphic" beside the word it duplicates.
    const offenders: string[] = [];
    for (const { name, source } of files) {
      for (const match of code(source).matchAll(/<svg\b([^>]*)>/g)) {
        const attrs = match[1] ?? "";
        if (!/aria-hidden|role="img"|aria-label/.test(attrs)) {
          offenders.push(`${name}: ${match[0].slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("nothing interactive is unreachable by keyboard (NFR-ACC-006)", () => {
  it("puts onClick on a button or a link, not on a div", () => {
    // A <div onClick> cannot be tabbed to and does not fire on Enter. This is
    // the single most common way a working screen becomes unusable without a
    // mouse, and it is invisible to everyone who has one.
    const offenders: string[] = [];
    for (const { name, source } of files) {
      for (const match of code(source).matchAll(/<(div|span|li|td|tr)\b([^>]*)>/g)) {
        const attrs = match[2] ?? "";
        if (!/onClick/.test(attrs)) continue;
        if (/role="button"|tabIndex/.test(attrs)) continue;
        // The register's rows. FR-ATT-005 requires full keyboard operation and
        // AttendancePage implements it with a document-level arrow-key handler
        // that moves a cursor through the grid — the click is a mouse
        // convenience on top of that, not the only way in. Making each row
        // focusable would put forty tab stops between the teacher and the
        // Save button, which is worse for the person this rule protects.
        if (name === "pages/AttendancePage.tsx" && match[1] === "tr") continue;
        offenders.push(`${name}: ${match[0].replace(/\s+/g, " ").slice(0, 70)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("errors are announced, not merely displayed (NFR-ACC-008)", () => {
  it("marks alert boxes with a role so a screen reader speaks them", () => {
    // A validation message that appears silently is a message a blind user
    // never receives. Counted rather than listed per file: some alerts are
    // static prose in a card and do not need announcing.
    let withRole = 0;
    let total = 0;
    for (const { source } of files) {
      for (const match of code(source).matchAll(/<div className=(?:"|\{`)[^"`]*alert-error[^"`]*(?:"|`\})([^>]*)>/g)) {
        total++;
        if (/role="alert"|aria-live/.test(match[1] ?? "")) withRole++;
      }
    }
    expect(total).toBeGreaterThan(0);
    // Every ERROR alert, specifically. Informational ones are exempt above.
    expect({ total, withRole }).toEqual({ total, withRole: total });
  });
});
