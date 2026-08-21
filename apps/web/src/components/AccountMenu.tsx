import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";
import { useTheme } from "./useTheme";
import type { Theme } from "./useTheme";
import { useDismissable } from "./useDismissable";

/**
 * Who you are, and the three things you do about it.
 *
 * SIGN OUT WAS AT THE BOTTOM OF THE SIDEBAR. On a desktop that is merely
 * unusual; on a phone the sidebar is a drawer, so signing out meant opening
 * the menu, scrolling past up to twenty-four destinations, and pressing a
 * button with no label next to your own name. It is now in the top strip,
 * which is where every product this will be compared to puts it.
 *
 * The sidebar footer keeps the name and the role — it is useful to see whose
 * session this is without opening anything, and on the rail it is the one
 * thing that says you are signed in at all.
 */

const THEMES: Array<{ value: Theme; label: string; icon: "monitor" | "sun" | "moon" }> = [
  { value: "system", label: "Match my system", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

export function AccountMenu({ initials, roleLabel }: { initials: string; roleLabel: string }) {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /*
   * Closing: a click anywhere else, or Escape.
   *
   * Escape returns focus to the button that opened it. Without that, dismissing
   * the menu by keyboard drops the caret at the top of the document and the
   * next Tab starts from the skip link — which is how a menu becomes a thing
   * keyboard users stop opening.
   */
  const close = useCallback(() => setOpen(false), []);
  // The same behaviour the inbox now has, from the same place — see the note
  // on the hook for why it stopped living in this file.
  useDismissable(open, close, { wrap, trigger });

  if (!user) return null;

  const name = user.fullName || user.email;

  return (
    <div className="account" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
      </button>

      {open && (
        <div className="account-panel" role="menu">
          <div className="account-who">
            <strong className="account-name">{name}</strong>
            {/*
              The role in words a person uses, and a student's registration
              number beside it. FR-REG-021 makes that number the thing a
              student is asked for on the telephone, and it lived on one
              screen — so finding it meant navigating away from whatever
              prompted the question.
            */}
            <span className="account-role">
              {roleLabel}
              {user.student?.registrationNo ? ` · ${user.student.registrationNo}` : ""}
            </span>
          </div>

          <Link className="account-item" role="menuitem" to="/change-password" onClick={close}>
            <Icon name="key" />
            Change password
          </Link>

          <hr className="account-rule" />

          {/* A radio group, not a cycling button. Three states cycled by one
              control means pressing it twice to find out what the third one
              was, and the current state is the thing a toggle hides. */}
          <div role="group" aria-label="Appearance">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                className="account-item"
                role="menuitemradio"
                aria-checked={theme === t.value}
                onClick={() => setTheme(t.value)}
              >
                <Icon name={t.icon} />
                {t.label}
                {theme === t.value && (
                  <span className="account-check" aria-hidden="true">
                    <Icon name="tick" />
                  </span>
                )}
              </button>
            ))}
          </div>

          <hr className="account-rule" />

          <button
            type="button"
            className="account-item"
            role="menuitem"
            onClick={() => {
              close();
              void signOut();
            }}
          >
            <Icon name="logout" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
