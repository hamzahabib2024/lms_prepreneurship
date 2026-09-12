import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Light, dark, or whatever the device says.
///
/// The palette has had a dark half since the redesign — every widget in this
/// app already branches on `Theme.of(context).brightness` — and the only way
/// to reach it was to change the phone's own setting, which is the wrong
/// place to ask. A student in a bright lecture hall and an administrator at a
/// desk at nine at night want different things on the same phone within the
/// same hour.
///
/// THREE STATES, NOT TWO, and the third is the default. "System" is not a
/// fallback for people who have not chosen; it is a choice, and the right one
/// for most people most of the time, because it tracks the device at dusk
/// without anybody touching anything. A two-state toggle has to guess an
/// initial value and then diverges from the device for good.
class ThemeController extends ValueNotifier<ThemeMode> {
  ThemeController._() : super(ThemeMode.system);

  static final ThemeController instance = ThemeController._();

  static const _key = 'lms.theme';

  SharedPreferences? _prefs;

  /// Read BEFORE the first frame, not after.
  ///
  /// Loading in an initState means the first paint is the device's theme and
  /// the second is the chosen one — a white flash on every launch for
  /// somebody who asked for dark, which is precisely the person most bothered
  /// by it.
  Future<void> load() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      value = _decode(_prefs?.getString(_key));
    } catch (_) {
      // A theme is not worth failing a launch over, and following the device
      // is the correct answer when the stored choice cannot be read.
      value = ThemeMode.system;
    }
  }

  Future<void> set(ThemeMode mode) async {
    if (mode == value) return;
    value = mode;
    try {
      final prefs = _prefs ??= await SharedPreferences.getInstance();
      if (mode == ThemeMode.system) {
        await prefs.remove(_key);
      } else {
        await prefs.setString(_key, mode == ThemeMode.dark ? 'dark' : 'light');
      }
    } catch (_) {
      // The choice still holds for this run; it simply will not survive a
      // restart. Better than refusing to change the theme at all.
    }
  }

  /// system → light → dark → system.
  ///
  /// A cycle rather than a menu, because three states do not deserve a menu —
  /// and the third state is not dropped, which is the usual temptation with a
  /// cycling control.
  Future<void> cycle() => set(switch (value) {
        ThemeMode.system => ThemeMode.light,
        ThemeMode.light => ThemeMode.dark,
        ThemeMode.dark => ThemeMode.system,
      });

  static ThemeMode _decode(String? stored) => switch (stored) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
}

/// What the current state is, and what pressing will do.
///
/// THE ICON SHOWS THE CURRENT STATE, NOT THE NEXT ONE. A sun meaning "you are
/// in light mode" and a sun meaning "press for light mode" are the same
/// picture with opposite meanings. The label says what pressing does, so a
/// screen reader gets the action and a sighted user gets the state.
extension ThemeModeLabels on ThemeMode {
  IconData get icon => switch (this) {
        ThemeMode.system => Icons.brightness_auto_outlined,
        ThemeMode.light => Icons.light_mode_outlined,
        ThemeMode.dark => Icons.dark_mode_outlined,
      };

  String get stateLabel => switch (this) {
        ThemeMode.system => 'Following your device',
        ThemeMode.light => 'Light',
        ThemeMode.dark => 'Dark',
      };

  String get actionLabel => switch (this) {
        ThemeMode.system => 'Switch to light',
        ThemeMode.light => 'Switch to dark',
        ThemeMode.dark => 'Follow your device',
      };
}

/// One button. Cycles the three states and announces both halves.
class ThemeToggle extends StatelessWidget {
  const ThemeToggle({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<ThemeMode>(
      valueListenable: ThemeController.instance,
      builder: (context, mode, _) {
        final description = 'Appearance: ${mode.stateLabel}. ${mode.actionLabel}.';
        return IconButton(
          icon: Icon(mode.icon),
          tooltip: description,
          // The state for anybody reading, the action for anybody pressing.
          onPressed: ThemeController.instance.cycle,
        );
      },
    );
  }
}
