import { useCallback, useEffect, useState } from "react";

/**
 * Light, dark, or whatever the machine says.
 *
 * The stylesheet has had a dark palette since the redesign and the only way to
 * reach it was to change your operating system — which is the wrong place to
 * ask. A student in a bright lecture hall and an administrator at a desk at
 * nine at night want different things on the same laptop within the same hour.
 *
 * THREE STATES, NOT TWO, and the third is the default. "System" is not a
 * fallback for people who have not chosen; it is a choice, and it is the right
 * one for most people most of the time. A two-state toggle has to guess an
 * initial value and then diverges from the machine forever after.
 *
 * The attribute goes on <html> rather than <body> so the tokens land on
 * :root, and it is REMOVED for system rather than set to "system" — the
 * stylesheet's guarded media query is written to key off its absence.
 */

export type Theme = "system" | "light" | "dark";

const KEY = "lms.theme";

function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing, a blocked origin, a quota. A theme is not worth
    // throwing over, and "system" is the correct answer when we cannot know.
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/*
 * Applied before React mounts, not after.
 *
 * Waiting for an effect means the first paint is the system's theme and the
 * second is the chosen one — a white flash on every load for somebody who
 * asked for dark, which is precisely the person most bothered by it.
 */
apply(read());

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // The choice still holds for this tab; it simply will not survive a
      // reload. Better than refusing to change the theme at all.
    }
  }, []);

  return { theme, setTheme };
}
