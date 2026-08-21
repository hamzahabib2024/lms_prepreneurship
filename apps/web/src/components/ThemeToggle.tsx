import { useTheme, type Theme } from "./useTheme";
import { Icon } from "./Icon";

/**
 * Light, dark, or the machine — one button in the top bar.
 *
 * WHY IT IS HERE AND NOT ONLY IN THE ACCOUNT MENU. The setting existed and was
 * two clicks inside a menu whose label is somebody's name — which is where you
 * look for "sign out", not for "this screen is too bright". A student in a
 * lecture hall at noon and an administrator at a desk at nine at night want
 * different things on the same laptop within the same hour, and neither should
 * have to go looking.
 *
 * IT CYCLES RATHER THAN OPENING A MENU, because there are three states and a
 * menu for three states is a menu to avoid. The order is the useful one:
 *
 *     system → light → dark → system
 *
 * THE THIRD STATE IS NOT DROPPED, which is the temptation with a cycling
 * control. "System" is not a fallback for people who have not chosen; it is
 * the right answer for most people most of the time, because it tracks the
 * machine at dusk without anybody touching anything. A two-state toggle has to
 * guess an initial value and then diverges from the machine for good.
 *
 * THE ICON SHOWS THE CURRENT STATE, NOT THE NEXT ONE. A sun that means "you are
 * in light mode" and a sun that means "press for light mode" are the same
 * picture with opposite meanings, and every product that picks the second one
 * has an argument about it afterwards. The label says what pressing it does,
 * so a screen reader gets the action and a sighted user gets the state.
 */

const NEXT: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const LABEL: Record<Theme, { icon: string; is: string; next: string }> = {
  system: { icon: "monitor", is: "Following your device", next: "Switch to light" },
  light: { icon: "sun", is: "Light", next: "Switch to dark" },
  dark: { icon: "moon", is: "Dark", next: "Follow your device" },
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = LABEL[theme];

  return (
    <button
      type="button"
      className="btn btn-quiet theme-toggle"
      onClick={() => setTheme(NEXT[theme])}
      // The state for anybody reading, the action for anybody pressing.
      title={`Appearance: ${current.is}. ${current.next}.`}
      aria-label={`Appearance: ${current.is}. ${current.next}.`}
    >
      <Icon name={current.icon} />
    </button>
  );
}
