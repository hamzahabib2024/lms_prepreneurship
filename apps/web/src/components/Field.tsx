import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";

/**
 * A FORM FIELD THAT SAYS WHETHER IT IS RIGHT — and, when it is not, why.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS COMPONENT EXISTS TO HOLD:
 *
 *     NOTHING IS MARKED WRONG BEFORE THE PERSON HAS HAD A CHANCE TO GET IT RIGHT.
 *
 * A blank form covered in red crosses tells somebody they have made a mistake
 * they have not yet had the opportunity to make. So a field is `touched` only
 * once it has been left — on blur — or once a submit has been attempted, and
 * until then it shows nothing at all. Every other decision here follows from
 * that one.
 *
 * GREEN MEANS VALID, NEVER MERELY FILLED. A box containing "abc" under a label
 * saying Email is full and wrong, and a tick on it is a lie that costs somebody
 * a rejected form and a wasted trip. Validity is read from THREE sources, in
 * this order, because they answer different questions:
 *
 *   1. `error` — what the SERVER said. Always wins: it is the only one of the
 *      three that knows whether the email is already registered.
 *   2. the DOM's own `checkValidity()` — type=email, pattern, min, max, required.
 *      Free, and already correct.
 *   3. `validate` — the rule the browser cannot know, like a CNIC being
 *      thirteen digits. Give it the Zod message from @lms/shared so the screen
 *      and the server cannot disagree about what is acceptable.
 *
 * THE SHAPE AND THE COLOUR BOTH CARRY THE MEANING, and the shape carries more.
 * Red and green is the worst pair in interface design — roughly one man in
 * twelve cannot separate them — so the tick and the cross are the signal and
 * the colour is decoration on top (NFR-ACC-007). The message is a third signal
 * again, and it is the only one that says what to actually do.
 *
 * THE TICK IS QUIET AND THE CROSS IS LOUD. Nineteen green badges on the
 * application form would be a Christmas tree, and the one field that is wrong
 * would be harder to find, not easier. So a correct field gets a small tick
 * beside its label; a wrong one gets a cross, a red edge and a sentence.
 *
 * IT WRAPS, IT DOES NOT REPLACE. The child is cloned and given an id, the ARIA
 * and a blur handler — every other prop stays exactly as the form wrote it.
 * That keeps the `<label className="field"><span>…</span><input/></label>` shape
 * the whole stylesheet is built on, and makes adopting it a two-line change per
 * field instead of a rewrite.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type FieldState = "neutral" | "valid" | "invalid";

export function Field({
  label,
  hint,
  required = false,
  error = null,
  validate,
  /** Set by a form when Submit was pressed, so untouched fields report too. */
  submitted = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  /** What the server said about this field. Beats anything decided locally. */
  error?: string | null;
  /** A rule the browser cannot express. Returns a message, or null if fine. */
  validate?: (value: string) => string | null;
  submitted?: boolean;
  /** One input, select or textarea. Cloned, never rebuilt. */
  children: ReactElement<{
    id?: string;
    value?: string | number | readonly string[];
    onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    "data-touched"?: string;
  }>;
}) {
  const id = useId();
  const messageId = `${id}-message`;
  const [touched, setTouched] = useState(false);

  /*
   * PRESSING SAVE REVEALS WHAT WAS MISSED.
   *
   * THE HOLE THIS CLOSES. A field is "touched" when you leave it — which never
   * happens to the field you SKIPPED. So somebody who filled four boxes,
   * missed the fifth and pressed Save saw nothing at all: no cross, no
   * message, and a button that either did nothing or produced a server error
   * about a field they could not see. That is the exact case this whole
   * feature exists for and it was the one case it did not cover.
   *
   * EACH FIELD DECIDES FOR ITSELF whether the click that just happened was an
   * attempt to submit ITS form. A document-level listener costs one handler
   * per field and needs no cooperation from thirty different forms, none of
   * which share a submit path — the alternative was threading a `submitted`
   * flag through every one of them, which is thirty chances to forget.
   *
   * The test is deliberately narrow: a primary or submit button inside the
   * same form, fieldset or card. A Cancel button, a tab, or a primary button
   * in a different card on the same screen does not reveal anything, because
   * none of those is somebody saying "I have finished filling this in".
   */
  const wrapper = useRef<HTMLLabelElement | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const button = el?.closest?.("button");
      if (!button) return;

      const isSubmitting =
        button.getAttribute("type") === "submit" || button.classList.contains("btn-primary");
      if (!isSubmitting) return;

      const field = wrapper.current;
      if (!field) return;

      /*
       * IS THAT BUTTON MINE? Two ways of being, because this application
       * writes forms in two shapes.
       *
       *   1. The button sits in the same card as the field — an ordinary
       *      panel with its own Save. Unambiguous.
       *
       *   2. The button sits in a card of its OWN, containing no fields at
       *      all — which is how the longer builders are laid out: "The work",
       *      "When", "Marking" as separate cards, then the Save and Publish
       *      buttons alone at the bottom. Scoping only to case 1 would leave
       *      exactly those forms — the longest ones, where a field is most
       *      easily missed — with no reveal at all.
       *
       * What this deliberately does NOT do is fire across two sibling forms on
       * one screen. Saving the "add a section" panel must not paint crosses
       * over the "add a term" panel beside it, so a button in a card that has
       * its own fields belongs to that card and to nothing else.
       */
      const region = field.closest("form, fieldset, .marker-panel, .card");
      if (region?.contains(button)) {
        setTouched(true);
        return;
      }

      const buttonCard = button.closest("form, fieldset, .card");
      const isPageLevelAction = !buttonCard || buttonCard.querySelector(".field") === null;
      if (isPageLevelAction) setTouched(true);
    };

    // Capture, so it still fires for a button whose own handler stops
    // propagation — which several of these forms do.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  /*
   * The control itself, so the browser's own verdict can be asked for. Reading
   * `validity` is how type=email and pattern are honoured without this
   * component reimplementing either — and reimplementing them is how a screen
   * ends up accepting something the form then refuses.
   */
  const control = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);

  const raw = children.props.value;
  const value = raw === undefined || raw === null ? "" : String(raw);
  const filled = value.trim() !== "";
  const show = touched || submitted;

  let state: FieldState = "neutral";
  let message: string | null = null;

  if (error) {
    // The server's answer, whether or not anybody has touched the field. If it
    // came back saying the address is taken, that is true immediately.
    state = "invalid";
    message = error;
  } else if (show) {
    if (required && !filled) {
      state = "invalid";
      message = "This is needed before you can continue.";
    } else if (!filled) {
      /*
       * AN EMPTY OPTIONAL FIELD IS NEITHER. Not a failure — nobody has to fill
       * it — and not a success either, because leaving a box blank is not an
       * achievement worth a green tick beside it.
       */
      state = "neutral";
    } else {
      const native = control.current;
      const nativeBad = native ? !native.checkValidity() : false;
      const custom = validate ? validate(value) : null;

      if (nativeBad || custom) {
        state = "invalid";
        // The browser's own wording ("Please enter an email address") is
        // serviceable but generic; a rule written for this form beats it.
        message = custom ?? native?.validationMessage ?? "That does not look right.";
      } else {
        state = "valid";
      }
    }
  }

  const child = cloneElement(children, {
    id,
    "aria-invalid": state === "invalid" ? true : undefined,
    // Points at the message only when there is one — a describedby aimed at an
    // element that is not rendered makes a screen reader announce nothing and
    // is worse than no association at all.
    "aria-describedby": message ? messageId : undefined,
    "data-touched": show ? "true" : undefined,
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      setTouched(true);
      children.props.onBlur?.(e);
    },
    ref: control,
  } as Record<string, unknown>);

  return (
    <label className={`field field-${state}`} htmlFor={id} ref={wrapper}>
      <span className="field-head">
        <span>
          {label}
          {/* An asterisk alone is a convention people mis-read; the word is
              unambiguous and costs one small line. */}
          {required && <span className="field-required"> (required)</span>}
        </span>

        {state === "valid" && (
          <span className="field-mark is-valid">
            <Icon name="tick" />
            {/* Named for a screen reader, which cannot see the tick. */}
            <span className="visually-hidden">Looks right</span>
          </span>
        )}
        {state === "invalid" && (
          <span className="field-mark is-invalid">
            <Icon name="cross" />
            <span className="visually-hidden">Needs fixing</span>
          </span>
        )}
      </span>

      {child}

      {/*
        THE MESSAGE IS ANNOUNCED, not merely shown (NFR-ACC-008). `role="alert"`
        would interrupt a screen reader mid-word while somebody is still tabbing
        through a form, so this is a polite live region: it is read when the
        reader next pauses, which is the right manners for a field-level note.
      */}
      {message && (
        <span className="field-message" id={messageId} aria-live="polite">
          {message}
        </span>
      )}

      {/* The hint stays put whether or not there is a message — it explains the
          field, and it is needed most by the person who just got it wrong. */}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}
