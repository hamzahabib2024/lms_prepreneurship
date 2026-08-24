import { CATALOGUE, definitionFor, validateValue, type SettingDefinition } from "../settings/settings-catalogue";

/**
 * WHICH SETTINGS THE PUBLIC PAGE EDITOR MAY TOUCH — and nothing else.
 *
 * This file is the entire security of that editor, so it is small, pure and
 * tested on its own.
 *
 * THE DANGER IT EXISTS TO REMOVE. Writing a setting is `system_setting:
 * configure`, which §4.5 grants to a Super Admin alone, because settings decide
 * when a student is warned, how progress is weighted and what a certificate
 * requires. The public page editor hands an ADMIN a write path into the same
 * table. If that path took any key it was given, it would be a complete bypass
 * of that rule wearing a marketing hat: an Admin could lower the attendance
 * threshold through the screen that edits a headline, and the audit log would
 * record it as an ordinary setting change.
 *
 * So the allow-list is not a list of keys somebody remembered to type. It is
 * DERIVED from the catalogue's own grouping — a setting is editable here if and
 * only if it declares itself part of the Public page group — which means the
 * two can never drift apart. Adding a public-page setting makes it editable;
 * moving a setting out of that group removes it, in the same edit, in one file.
 *
 * WHAT THAT GROUP IS ALLOWED TO CONTAIN is therefore a real constraint rather
 * than a naming convention, and it has exactly one rule: nothing in it may
 * decide anything about a person. Every value it holds is already published to
 * the world by the Institute — a headline, a video link, the name of a button.
 * The worst outcome of a wrong one is an embarrassing sentence on a web page.
 * A guard test asserts the group holds nothing else.
 */

/** The catalogue group that marks a setting as public-page content. */
export const PUBLIC_PAGE_GROUP = "Public page";

/**
 * Belt and braces on the rule above.
 *
 * The group is the allow-list, so a setting mistakenly filed under it becomes
 * writable by an Admin. These prefixes say what such a setting may be named,
 * and the guard test checks the group against them — two independent things
 * that both have to be wrong before anything leaks.
 */
const ALLOWED_PREFIXES = ["public."] as const;

export interface PublicPageField {
  key: string;
  type: SettingDefinition["type"];
  description: string;
  default: unknown;
  value: unknown;
  /** Whether a stored override exists, so the editor can offer to remove it. */
  isOverridden: boolean;
  maxLength?: number;
  multiline?: boolean;
}

/** Every setting the editor may read and write, in catalogue order. */
export function publicPageDefinitions(): SettingDefinition[] {
  return CATALOGUE.filter((d) => d.group === PUBLIC_PAGE_GROUP);
}

export function publicPageKeys(): string[] {
  return publicPageDefinitions().map((d) => d.key);
}

export function isPublicPageKey(key: string): boolean {
  const def = definitionFor(key);
  return (
    def !== undefined &&
    def.group === PUBLIC_PAGE_GROUP &&
    // A secret has no business on a page served to strangers, and this route
    // returns values — so one filed here by mistake is refused rather than
    // read back (SEC-CRY-010).
    def.isSecret !== true &&
    ALLOWED_PREFIXES.some((p) => def.key.startsWith(p))
  );
}

export interface KeyProblem {
  key: string;
  message: string;
}

/**
 * Everything wrong with a proposed set of changes, before ANY of it is written.
 *
 * ALL OF IT, NOT THE FIRST. Somebody who has retyped a headline, two blurbs and
 * six feature cards and pressed Save once should be told about all four
 * mistakes at once, not shown one, corrected it, and been shown the next.
 *
 * A value of `null` means "remove the override and go back to the default",
 * which is always legal — there is nothing to validate about deleting a row.
 */
export function problemsWith(values: Record<string, unknown>): KeyProblem[] {
  const problems: KeyProblem[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!isPublicPageKey(key)) {
      problems.push({
        key,
        // Says which door this is, because the key may well be a real setting
        // — just not one this screen is allowed to change.
        message:
          `"${key}" is not part of the public page. This screen changes what visitors see; ` +
          "everything else is on the Settings screen, and a Super Admin changes it.",
      });
      continue;
    }

    if (value === null) continue;

    for (const p of validateValue(key, value)) {
      problems.push({ key, message: p.message });
    }
  }

  return problems;
}

/**
 * One feature card, as the Institute types it and as the page renders it.
 *
 * `icon | title | body`, which is the same shape `public.imageUrls` already
 * uses for a photograph and its caption. A separate table for six rows of text
 * would be a migration, a model, a controller and a scope rule, to hold what a
 * person can read and correct in a text box.
 */
export interface FeatureCard {
  icon: string;
  title: string;
  body: string;
}

/**
 * WHAT CANNOT BE READ IS DROPPED, and what is half-readable is kept.
 *
 * A line with a title and no body is a card with no description, which is a
 * reasonable thing to want. A line with nothing on it at all is somebody's
 * stray newline, and rendering an empty card for it makes the page look broken
 * in a way that is hard to trace back to a blank line in a settings box.
 */
export function parseFeatures(values: readonly string[] | undefined): FeatureCard[] {
  return (values ?? [])
    .flatMap((v) => v.split(/[\r\n]+/))
    .map((raw) => {
      const parts = raw.split("|").map((p) => p.trim());
      // Two fields or three. With two, the line is "title | body" and the card
      // gets the neutral marker — an administrator who omitted the icon meant
      // the words, and refusing the line would lose them.
      const [icon, title, body] =
        parts.length >= 3
          ? [parts[0] ?? "", parts[1] ?? "", parts.slice(2).join(" | ")]
          : ["layers", parts[0] ?? "", parts[1] ?? ""];
      if (!title) return null;
      return { icon: icon || "layers", title, body };
    })
    .filter((f): f is FeatureCard => f !== null)
    .slice(0, 12);
}
