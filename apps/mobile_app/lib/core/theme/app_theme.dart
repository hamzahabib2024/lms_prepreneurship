import 'package:flutter/material.dart';

/// The design system, ported token-for-token from the web app's styles.css
/// (apps/web/src/styles.css). The palette, radii, shadows and typography below
/// are the same contract the web client uses, so the two clients stay
/// indistinguishable in look and feel.
///
/// Contrast figures refer to the surface the colour sits on, not white.
abstract final class AppColors {
  // Brand. Indigo carries the product, amber marks the things that need a
  // second look. Both are dark enough to hold white text at 44px.
  static const brand600 = Color(0xFF4F46E5);
  static const brand700 = Color(0xFF4338CA); // 8.6:1 on white
  static const brand800 = Color(0xFF3730A3);
  static const brand050 = Color(0xFFEEF2FF);
  static const brand100 = Color(0xFFE0E7FF);

  static const accent600 = Color(0xFFD97706);
  static const accent050 = Color(0xFFFFFBEB);

  // Ink and surfaces.
  static const ink = Color(0xFF0F172A); // 17.4:1 on white
  static const ink2 = Color(0xFF334155); // 9.7:1
  static const muted = Color(0xFF64748B); // 4.8:1 — the floor
  static const line = Color(0xFFE2E8F0);
  static const lineStrong = Color(0xFFCBD5E1);
  static const bg = Color(0xFFF8FAFC);
  static const surface = Colors.white;
  static const surface2 = Color(0xFFF1F5F9);

  // Status. Never colour alone (NFR-ACC-007) — each is paired with a word.
  static const ok = Color(0xFF047857); // 4.8:1
  static const okBg = Color(0xFFECFDF5);
  static const warn = Color(0xFFB45309); // 4.6:1
  static const warnBg = Color(0xFFFFFBEB);
  static const error = Color(0xFFB91C1C); // 5.9:1
  static const errorBg = Color(0xFFFEF2F2);
}

/// Dark mode, by preference rather than a toggle — the same rule as the web.
/// Status colours are LIGHTENED here rather than reused: #b91c1c on a dark
/// surface fails contrast badly, and an error message nobody can read is worse
/// than no colour at all.
abstract final class AppColorsDark {
  static const brand600 = Color(0xFF818CF8);
  static const brand700 = Color(0xFFA5B4FC);
  static const brand800 = Color(0xFFC7D2FE);
  static const brand050 = Color(0xFF1E1B4B);
  static const brand100 = Color(0xFF312E81);

  static const accent600 = Color(0xFFFBBF24);
  static const accent050 = Color(0xFF292524);

  static const ink = Color(0xFFF1F5F9);
  static const ink2 = Color(0xFFCBD5E1);
  static const muted = Color(0xFF94A3B8); // 6.4:1 on surface
  static const line = Color(0xFF1E293B);
  static const lineStrong = Color(0xFF334155);
  static const bg = Color(0xFF020617);
  static const surface = Color(0xFF0F172A);
  static const surface2 = Color(0xFF1E293B);

  static const ok = Color(0xFF34D399);
  static const okBg = Color(0xFF052E26);
  static const warn = Color(0xFFFBBF24);
  static const warnBg = Color(0xFF2C1C02);
  static const error = Color(0xFFF87171);
  static const errorBg = Color(0xFF2D0D0D);
}

abstract final class AppRadius {
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 18.0;
}

abstract final class AppShadow {
  static const soft = <BoxShadow>[
    BoxShadow(
      color: Color(0x0F0F172A), // slab-900 at 6%
      blurRadius: 2,
      offset: Offset(0, 1),
    ),
    BoxShadow(
      color: Color(0x0A0F172A), // slab-900 at 4%
      blurRadius: 3,
      offset: Offset(0, 1),
    ),
  ];
  static const raised = <BoxShadow>[
    BoxShadow(
      color: Color(0x140F172A), // slab-900 at 8%
      blurRadius: 12,
      offset: Offset(0, 4),
    ),
    BoxShadow(
      color: Color(0x0A0F172A), // slab-900 at 4%
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  static const floating = <BoxShadow>[
    BoxShadow(
      color: Color(0x1F0F172A), // slab-900 at 12%
      blurRadius: 32,
      offset: Offset(0, 12),
    ),
    BoxShadow(
      color: Color(0x0F0F172A), // slab-900 at 6%
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
      onPrimary: dark ? const Color(0xFF1E1B4B) : Colors.white,
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
    );

    return base.copyWith(
      textTheme: base.textTheme
          .apply(
            bodyColor: dark ? AppColorsDark.ink : AppColors.ink,
            displayColor: dark ? AppColorsDark.ink : AppColors.ink,
            fontFamily: null,
          )
          .copyWith(
            // ~ h1: 1.5rem, 680 weight, -.02em
            headlineMedium: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.5,
              color: dark ? AppColorsDark.ink : AppColors.ink,
              height: 1.2,
            ),
            // ~ h2: 1.0625rem, 640 weight, -.01em
            titleMedium: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.2,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
            // ~ h3: .95rem, 640
            titleSmall: TextStyle(
              fontSize: 15.2,
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
            bodyMedium: TextStyle(
              fontSize: 15,
              height: 1.55,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
            bodySmall: TextStyle(
              fontSize: 13,
              height: 1.5,
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
            labelLarge: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
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
          borderSide: const BorderSide(color: AppColors.brand600, width: 2),
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
        style: FilledButton.styleFrom(
          backgroundColor: dark ? AppColorsDark.brand700 : AppColors.brand700,
          foregroundColor: dark ? const Color(0xFF1E1B4B) : Colors.white,
          disabledBackgroundColor: (dark ? AppColorsDark.brand700 : AppColors.brand700)
              .withValues(alpha: 0.5),
          minimumSize: const Size(64, 40),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.sm),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
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
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: dark ? AppColorsDark.brand700 : AppColors.brand700,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
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