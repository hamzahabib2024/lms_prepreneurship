import 'package:flutter/material.dart';

/// The design system, ported token-for-token from the web client's styles.css
/// (apps/web/src/styles.css), which is itself Brand Guidelines V2.0. The
/// palette, radii, shadows and typography below are the same contract, so the
/// two clients stay indistinguishable.
///
/// IF YOU CHANGE A VALUE HERE, CHANGE IT THERE. The two files are the only
/// copies of the palette in the repository and they are meant to agree; the
/// web side is checked by `npm run brand:audit`, and this side is checked by
/// theme_brand_test.dart beside it.
///
/// Contrast figures refer to the surface the colour sits on, not white, and
/// every one of them was computed rather than estimated.
abstract final class AppColors {
  // ------------------------------------------------------------- brand ----
  // §3.1 and §7.1. Navy carries the product; amber is the singular accent.
  // §3.2 forbids "bright generic blues, purples, teals, or rainbow
  // gradients", which is what the indigo #4338CA this replaced actually was.
  static const navy = Color(0xFF1A3C5E); // 11.3:1 on white, 10.3:1 on cream
  static const navyDeep = Color(0xFF0E2540);
  static const amber = Color(0xFFF5A623);
  static const cream = Color(0xFFF0F4F8);

  /// AMBER IS A FILL, NEVER TEXT ON LIGHT — it is 2.03:1 on white, so it
  /// cannot carry a word and cannot even serve as a 3:1 non-text indicator.
  /// This is the darkened amber for the places an accent has to be read.
  static const amberInk = Color(0xFF8A5700); // 6.1:1 on white, 5.5:1 on cream

  // The old names, kept so no widget had to change.
  static const brand600 = navy;
  static const brand700 = navy;
  static const brand800 = navyDeep;
  static const brand050 = Color(0xFFE8EEF5);
  static const brand100 = Color(0xFFD3DEEA);

  static const accent600 = amberInk;
  static const accent050 = Color(0xFFFEF6E7);

  /// §7.4 — the call to action is amber with navy on it, 5.6:1.
  static const cta = amber;
  static const ctaInk = navy;

  // -------------------------------------------------- ink and surfaces ----
  static const ink = Color(0xFF111827); // 17.7:1 on white, 16.1:1 on cream
  static const ink2 = Color(0xFF374151); // 10.4:1 on white

  /// The brand grey, darkened four per cent, and deliberately so: §7.1 gives
  /// #6B7280 and §3.1 gives the cream ground, and together they measure
  /// 4.37:1 — under the 4.5:1 §6.3 itself demands. This is 4.88:1 on cream.
  static const muted = Color(0xFF616B7B);

  static const line = Color(0xFFD3DCE6);
  static const lineStrong = Color(0xFFB6C3D2);
  static const bg = cream;
  static const surface = Colors.white;
  static const surface2 = Color(0xFFE4EAF1);

  // Status. §3.2: green is for status indicators only, never as a brand
  // colour. Never colour alone either — each is paired with a word.
  static const ok = Color(0xFF065F46); // 7.0:1 on cream
  static const okBg = Color(0xFFE6F2EE);
  static const warn = amberInk;
  static const warnBg = Color(0xFFFEF6E7);
  static const error = Color(0xFFB91C1C); // 5.9:1 on cream
  static const errorBg = Color(0xFFFCEDED);
}

/// Dark, built from the brand's own dark surfaces — §3.1 and §6.3.
///
/// The brand book does not specify a dark UI theme but it specifies every
/// ingredient of one: Navy Deep as the gradient base, Dark Charcoal for card
/// backgrounds on dark slides, white body text on navy, and amber for
/// highlights and CTAs.
///
/// ON A DARK GROUND THE ACCENT SWAPS. §3.2 is explicit — "On navy
/// backgrounds: white text for body, amber for highlights and CTAs" — so the
/// primary becomes amber here, where at 7.6:1 it can finally carry text, the
/// one thing it must never do on white.
abstract final class AppColorsDark {
  static const navy = Color(0xFF1A3C5E);
  static const navyDeep = Color(0xFF0E2540);
  static const amber = Color(0xFFF5A623);
  static const amberInk = amber; // 7.6:1 on the ground, 5.9:1 on a card

  static const brand600 = amber;
  static const brand700 = amber;
  static const brand800 = Color(0xFFFBBF4C);
  static const brand050 = Color(0xFF1B3A57);
  static const brand100 = Color(0xFF24486A);

  static const accent600 = amber;
  static const accent050 = Color(0xFF2A1C04);

  static const cta = amber;
  static const ctaInk = navy;

  static const ink = Colors.white; // 12.0:1 on a card
  static const ink2 = Color(0xFFD8E1EC); // 9.1:1
  static const muted = Color(0xFF9FB0C4); // 5.4:1 on a card
  static const line = Color(0xFF23415F);
  static const lineStrong = Color(0xFF33536F);
  static const bg = navyDeep;
  static const surface = Color(0xFF16304C);
  static const surface2 = Color(0xFF22405F);

  static const ok = Color(0xFF34D399); // 6.2:1 on a card
  static const okBg = Color(0xFF08331F);
  static const warn = Color(0xFFFBBF4C);
  static const warnBg = Color(0xFF2A1C04);
  static const error = Color(0xFFFCA5A5); // 6.0:1 on a card
  static const errorBg = Color(0xFF33161A);
}

/// §4.1 — Sora displays, Inter carries body and UI. Declared once so a widget
/// never names a family as a bare string.
abstract final class AppFonts {
  static const display = 'Sora';
  static const body = 'Inter';
}

abstract final class AppRadius {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 18.0;
}

abstract final class AppShadow {
  static const soft = <BoxShadow>[
    BoxShadow(
      color: Color(0x121A3C5E), // navy at 7%
      blurRadius: 2,
      offset: Offset(0, 1),
    ),
    BoxShadow(
      color: Color(0x0D1A3C5E), // navy at 5%
      blurRadius: 3,
      offset: Offset(0, 1),
    ),
  ];
  static const raised = <BoxShadow>[
    BoxShadow(
      color: Color(0x171A3C5E), // navy at 9%
      blurRadius: 12,
      offset: Offset(0, 4),
    ),
    BoxShadow(
      color: Color(0x0D1A3C5E), // navy at 5%
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  static const floating = <BoxShadow>[
    BoxShadow(
      color: Color(0x241A3C5E), // navy at 14%
      blurRadius: 32,
      offset: Offset(0, 12),
    ),
    BoxShadow(
      color: Color(0x121A3C5E), // navy at 7%
      blurRadius: 8,
      offset: Offset(0, 4),
    ),
  ];
}

abstract final class AppTheme {
  /// The one palette the app uses: brand indigo on slate. Built twice, once
  /// per brightness — dark follows the OS preference, exactly like the web.
  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ColorScheme _scheme(bool dark) {
    return ColorScheme(
      brightness: dark ? Brightness.dark : Brightness.light,
      primary: dark ? AppColorsDark.brand700 : AppColors.brand700,
      // On a dark ground the primary IS amber, so what sits on it is navy.
      onPrimary: dark ? AppColorsDark.ctaInk : Colors.white,
      secondary: dark ? AppColorsDark.brand600 : AppColors.brand600,
      onSecondary: Colors.white,
      error: dark ? AppColorsDark.error : AppColors.error,
      onError: Colors.white,
      surface: dark ? AppColorsDark.surface : AppColors.surface,
      onSurface: dark ? AppColorsDark.ink : AppColors.ink,
      surfaceContainerHighest:
          dark ? AppColorsDark.surface2 : AppColors.surface2,
      onSurfaceVariant: dark ? AppColorsDark.muted : AppColors.muted,
      outline: dark ? AppColorsDark.line : AppColors.line,
      outlineVariant: dark ? AppColorsDark.line : AppColors.line,
      surfaceContainerLowest: dark ? AppColorsDark.surface : AppColors.surface,
      surfaceContainerLow: dark ? AppColorsDark.bg : AppColors.bg,
      surfaceContainer: dark ? AppColorsDark.surface2 : AppColors.surface2,
      surfaceContainerHigh: dark ? AppColorsDark.surface2 : AppColors.surface2,
    );
  }

  static ThemeData _build(Brightness brightness) {
    final dark = brightness == Brightness.dark;

    final scheme = _scheme(dark);

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark ? AppColorsDark.bg : AppColors.bg,
      // §4.1 — Inter carries body and UI everywhere it is not overridden.
      fontFamily: AppFonts.body,
    );

    return base.copyWith(
      textTheme: base.textTheme
          .apply(
            bodyColor: dark ? AppColorsDark.ink : AppColors.ink,
            displayColor: dark ? AppColorsDark.ink : AppColors.ink,
            fontFamily: AppFonts.body,
          )
          .copyWith(
            /*
             * HEADINGS ARE SORA — §4.3, "Headlines use the display font,
             * never the body font" — with the negative tracking §4.3 asks
             * for. Sizes follow the web client exactly, which sits at the
             * lower end of §4.2's web scale because these are application
             * screens rather than a marketing hero.
             */
            headlineMedium: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 28, // §4.2 H3 Subhead band
              fontWeight: FontWeight.w600,
              letterSpacing: -0.84, // -0.03em
              color: dark ? AppColorsDark.ink : AppColors.ink,
              height: 1.15,
            ),
            titleLarge: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 22,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.55,
              color: dark ? AppColorsDark.ink : AppColors.ink,
              height: 1.2,
            ),
            titleMedium: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 18, // §4.2 H4 Card Title band
              fontWeight: FontWeight.w600,
              letterSpacing: -0.36, // -0.02em
              color: dark ? AppColorsDark.ink : AppColors.ink,
              height: 1.3,
            ),
            titleSmall: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 16,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.24,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
            // §4.2 puts body at 16-18px and §4.3 makes 1.6 a floor. It was
            // 15 on 1.55, under both.
            bodyMedium: TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 16,
              height: 1.6,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
            bodySmall: TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 13.5,
              height: 1.5,
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
            // §4.2 CTA / Button: 14-16, medium.
            labelLarge: const TextStyle(
              fontFamily: AppFonts.body,
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
            // §4.3 — an eyebrow is tracked +0.18em to +0.22em.
            labelSmall: TextStyle(
              fontFamily: AppFonts.display,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.98, // 0.18em at 11px
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
          ),
      inputDecorationTheme: InputDecorationTheme(
        labelStyle: TextStyle(
          color: dark ? AppColorsDark.muted : AppColors.muted,
          fontSize: 14,
        ),
        hintStyle: TextStyle(
          color: (dark ? AppColorsDark.muted : AppColors.muted).withValues(alpha: 0.85),
        ),
        floatingLabelStyle: TextStyle(
          color: dark ? AppColorsDark.brand600 : AppColors.brand600,
          fontSize: 13,
        ),
        prefixIconColor: dark ? AppColorsDark.muted : AppColors.muted,
        filled: false,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.lineStrong : AppColors.lineStrong,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          // Was pinned to the light brand colour in both themes, so on a dark
          // ground the focused field was outlined in a colour from the other
          // palette.
          borderSide: BorderSide(
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.error : AppColors.error,
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.error : AppColors.error,
            width: 2,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        // §7.4 .btn--primary — amber ground, navy text, 5.6:1. It was
        // white on indigo, which made the call to action the same colour as
        // the furniture around it.
        style: FilledButton.styleFrom(
          backgroundColor: dark ? AppColorsDark.cta : AppColors.cta,
          foregroundColor: dark ? AppColorsDark.ctaInk : AppColors.ctaInk,
          disabledBackgroundColor:
              (dark ? AppColorsDark.cta : AppColors.cta).withValues(alpha: 0.5),
          minimumSize: const Size(64, 40),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: dark ? AppColorsDark.ink : AppColors.ink,
          minimumSize: const Size(64, 40),
          side: BorderSide(
            color: dark ? AppColorsDark.lineStrong : AppColors.lineStrong,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: dark ? AppColorsDark.brand700 : AppColors.brand700,
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      cardTheme: CardThemeData(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          side: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: dark ? AppColorsDark.line : AppColors.line,
        thickness: 1,
        space: 1,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: dark ? AppColorsDark.ink : AppColors.ink,
        contentTextStyle: TextStyle(
          color: dark ? AppColorsDark.bg : AppColors.bg,
          fontSize: 14,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
      ),
    );
  }
}