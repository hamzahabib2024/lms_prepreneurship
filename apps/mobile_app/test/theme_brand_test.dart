import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/theme/app_theme.dart';

/// THE MOBILE PALETTE IS THE BRAND'S, AND IT IS THE WEB'S.
///
/// Two copies of a palette drift. The web side is guarded by
/// `npm run brand:audit` at the repository root; this is the same set of
/// assertions for the Flutter client, so a value changed on one side and not
/// the other fails a build rather than being noticed in a screenshot months
/// later.
///
/// The hex literals below are deliberately written out rather than read from
/// AppColors. A test that compares a constant to itself passes no matter what
/// the constant becomes, which is the most common way a guard like this ends
/// up guarding nothing.

/// WCAG 2.1 relative luminance.
double _luminance(Color c) {
  double channel(double v) {
    return v <= 0.04045 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  }

  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

double _contrast(Color a, Color b) {
  final la = _luminance(a);
  final lb = _luminance(b);
  final hi = math.max(la, lb);
  final lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  group('Brand Guidelines V2.0 §3.1 — the palette is exact', () {
    test('primary palette matches the brand book', () {
      expect(AppColors.navy, const Color(0xFF1A3C5E));
      expect(AppColors.navyDeep, const Color(0xFF0E2540));
      expect(AppColors.amber, const Color(0xFFF5A623));
      expect(AppColors.cream, const Color(0xFFF0F4F8));
      expect(AppColors.ink, const Color(0xFF111827));
      expect(AppColors.ok, const Color(0xFF065F46));
    });

    test('the palette matches the web client token for token', () {
      // apps/web/src/styles.css — :root. If you change one, change both.
      expect(AppColors.bg, AppColors.cream);
      expect(AppColors.surface, Colors.white);
      expect(AppColors.brand700, AppColors.navy);
      expect(AppColorsDark.bg, AppColorsDark.navyDeep);
      expect(AppColorsDark.surface, const Color(0xFF16304C));
    });
  });

  group('§3.2 / §3.3 / §10.02 — nothing prohibited survives', () {
    // "Never use bright generic blues, purples, teals, or rainbow gradients",
    // plus the three colours §3.3 retires by name.
    const banned = <int>[
      0xFF4F46E5, 0xFF4338CA, 0xFF3730A3, // indigo
      0xFF7C3AED, 0xFF6D28D9, 0xFFC026D3, // violet, fuchsia
      0xFF0D9488, 0xFF0D7377, 0xFF0891B2, // teal, cyan
      0xFF2563EB, 0xFFEA580C, // bright blue, orange-red
      0xFFCA8A04, 0xFFA16207, 0xFFC9A84C, // retired gold
      0xFF1B2A4A, // retired navy
    ];

    test('no brand or surface token is a prohibited colour', () {
      final tokens = <String, Color>{
        'navy': AppColors.navy,
        'navyDeep': AppColors.navyDeep,
        'amber': AppColors.amber,
        'amberInk': AppColors.amberInk,
        'cream': AppColors.cream,
        'ink': AppColors.ink,
        'ink2': AppColors.ink2,
        'muted': AppColors.muted,
        'brand600': AppColors.brand600,
        'brand700': AppColors.brand700,
        'brand800': AppColors.brand800,
        'accent600': AppColors.accent600,
        'cta': AppColors.cta,
        'ok': AppColors.ok,
        'warn': AppColors.warn,
        'error': AppColors.error,
        'dark.brand600': AppColorsDark.brand600,
        'dark.brand700': AppColorsDark.brand700,
        'dark.surface': AppColorsDark.surface,
        'dark.bg': AppColorsDark.bg,
        'dark.cta': AppColorsDark.cta,
      };
      final offenders = <String>[];
      tokens.forEach((name, colour) {
        if (banned.contains(colour.toARGB32())) {
          offenders.add('$name = ${colour.toARGB32().toRadixString(16)}');
        }
      });
      expect(offenders, isEmpty);
    });
  });

  group('NFR-ACC-004 — every pair clears its threshold', () {
    test('light: text on its own ground', () {
      expect(_contrast(AppColors.navy, Colors.white), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.navy, AppColors.cream), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.ink, AppColors.cream), greaterThanOrEqualTo(4.5));
      // The reason muted is #616B7B and not the book's #6B7280: that one
      // measures 4.37:1 here and fails.
      expect(_contrast(AppColors.muted, AppColors.cream), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.muted, Colors.white), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.ok, AppColors.cream), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.error, AppColors.cream), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColors.warn, AppColors.cream), greaterThanOrEqualTo(4.5));
    });

    test('§7.4 — navy on the amber call to action', () {
      expect(_contrast(AppColors.ctaInk, AppColors.cta), greaterThanOrEqualTo(4.5));
    });

    test('AMBER IS NEVER TEXT ON LIGHT — it cannot be', () {
      // 2.03:1. This asserts the FAILURE, so that anybody tempted to set a
      // label in brand amber finds the reason written down rather than
      // discovering it from a user who cannot read the label.
      expect(_contrast(AppColors.amber, Colors.white), lessThan(3.0));
    });

    test('dark: text on the dark ground and on a card', () {
      expect(_contrast(AppColorsDark.ink, AppColorsDark.bg), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColorsDark.ink2, AppColorsDark.surface), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColorsDark.muted, AppColorsDark.surface), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColorsDark.amber, AppColorsDark.surface), greaterThanOrEqualTo(4.5));
      expect(_contrast(AppColorsDark.error, AppColorsDark.surface), greaterThanOrEqualTo(4.5));
    });
  });

  group('§4 — typography', () {
    test('Sora displays and Inter carries body', () {
      expect(AppFonts.display, 'Sora');
      expect(AppFonts.body, 'Inter');
    });

    test('headings are set in the display face, body in the body face', () {
      final t = AppTheme.light().textTheme;
      expect(t.headlineMedium?.fontFamily, AppFonts.display);
      expect(t.titleMedium?.fontFamily, AppFonts.display);
      expect(t.bodyMedium?.fontFamily, AppFonts.body);
    });

    test('§4.2 body is 16–18px and §4.3 line-height is at least 1.6', () {
      final body = AppTheme.light().textTheme.bodyMedium!;
      expect(body.fontSize, inInclusiveRange(16, 18));
      expect(body.height, greaterThanOrEqualTo(1.6));
    });

    test('§4.3 headline tracking is negative', () {
      expect(AppTheme.light().textTheme.headlineMedium!.letterSpacing, lessThan(0));
    });
  });

  group('§7.4 — the call to action', () {
    test('the filled button is amber with navy on it, in both themes', () {
      for (final theme in [AppTheme.light(), AppTheme.dark()]) {
        final style = theme.filledButtonTheme.style!;
        final bg = style.backgroundColor!.resolve({});
        final fg = style.foregroundColor!.resolve({});
        expect(bg, AppColors.amber);
        expect(fg, AppColors.navy);
      }
    });
  });
}
