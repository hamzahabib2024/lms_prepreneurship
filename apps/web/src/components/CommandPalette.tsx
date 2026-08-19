import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { destinationsFor, searchDestinations } from "../navigation";
import type { Destination } from "../navigation";
import { Icon } from "./Icon";

/**
 * Go anywhere, by typing.
 *
 * A Super Admin is offered twenty-four destinations and a student eight, and
 * until now finding one meant knowing which of five headings owned it. The
 * Settings screen already learned this lesson — a filter was added across its
 * thirty-two settings because findability, not layout, was the real problem
 * there — and the fix stayed trapped on that one page.
 *
 * IT SEARCHES DESTINATIONS, NOT DATA, AND IT SAYS SO IN THE PLACEHOLDER.
 * There is no global search endpoint on the server; a palette that returned
 * only pages while looking as though it also searched students would be worse
 * than not having one, because the empty result would read as "no such
 * student" rather than "I never looked".
 *
 * IT CANNOT OFFER WHAT THE SIDEBAR HIDES. Both read `destinationsFor` with the
 * same `hasRole`, so there is one list and one set of predicates. A second
 * hand-written copy of that list is a second place for a role predicate to be
 * wrong, and this is the kind of wrong nobody notices until the wrong person
 * notices it. As ever, this is the interface not offering something — ARC-003
 * puts the actual refusal on the server.
 */

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const available = useMemo(() => destinationsFor(hasRole), [hasRole]);
  const results = useMemo(() => searchDestinations(available, query), [available, query]);

  // A fresh query starts at the top. Without this, typing a second letter that
  // narrows five results to two leaves the cursor pointing past the end.
  useEffect(() => setActive(0), [query]);

  // Opening clears whatever was typed last time. A palette that reopens
  // holding a stale query answers a question nobody asked.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
  }, [open]);

  const go = useCallback(
    (d: Destination) => {
      onClose();
      // The public page leaves the application shell, so it is a document
      // load rather than a route change — the same reason the sidebar links
      // to it with a plain anchor.
      if (d.leavesApp) window.location.href = d.to;
      else navigate(d.to);
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        setActive((i) => (results.length ? (i + 1) % results.length : 0));
        return;
      }
      if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = results[active];
        if (chosen) go(chosen);
      }
    },
    [results, active, go, onClose],
  );

  // Keep the highlighted row in view when the arrows walk past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(".palette-item.is-active");
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  return (
    <>
      {/*
        The backdrop is a real <button>, for the same reason the mobile
        drawer's is: a div with a click handler cannot be tabbed to and does
        not fire on Enter, so a keyboard user could open this and not close it.

        It is a SIBLING of the dialog rather than its parent. Wrapping would
        put an <input> and a list of buttons inside a <button>, which is
        invalid, and browsers resolve it by swallowing the clicks on
        everything inside — the palette would open and nothing in it would
        work.
      */}
      <button type="button" className="palette-scrim" aria-label="Close the search" onClick={onClose} />
      <div className="palette-wrap">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        onKeyDown={onKeyDown}
      >
        <div className="palette-field">
          <Icon name="search" />
          <label className="visually-hidden" htmlFor="palette-query">
            Search the screens you can open
          </label>
          <input
            id="palette-query"
            ref={input}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a screen…"
            autoComplete="off"
            spellCheck={false}
            aria-controls="palette-results"
          />
        </div>

        {results.length === 0 ? (
          /*
             NFR-USE-009 — say what was searched, not just that nothing matched.
             "No results" here would be read as "no such student", and this has
             never looked at a student.
           */
          <p className="palette-empty">
            No screen called “{query.trim()}”. This searches screens, not students or classes.
          </p>
        ) : (
          <ul className="palette-results" id="palette-results" role="listbox" aria-label="Screens">
            {results.map((d, i) => (
              <li key={d.to}>
                <button
                  type="button"
                  className={i === active ? "palette-item is-active" : "palette-item"}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => go(d)}
                  // The pointer does NOT move the selection — see the note in
                  // the stylesheet. It only acts on what it presses.
                  onFocus={() => setActive(i)}
                >
                  <Icon name={d.icon} />
                  {d.label}
                  {d.group && <span className="palette-item-where">{d.group}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="palette-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">Enter</span> to open
          </span>
          <span>
            <span className="kbd">Esc</span> to close
          </span>
        </div>
      </div>
      </div>
    </>
  );
}
