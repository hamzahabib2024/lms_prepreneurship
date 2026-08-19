import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';

/// The brand half of the sign-in screen — ported from the web's `.auth-brand`.
///
/// On a phone it collapses into a header (logo + headline only) so the form
/// stays above the fold; on wider screens it becomes the full brand panel
/// with the three points. What it claims is deliberately modest and TRUE.
class AuthBrandPanel extends StatelessWidget {
  const AuthBrandPanel({super.key, required this.compact});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 28 : 40,
        vertical: compact ? 26 : 48,
      ),
      // §6.3 — the brand's own overlay: navy-deep to navy. It ran to
      // #6D28D9, a violet, which §3.2 prohibits outright and which was the
      // first colour anybody saw.
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.navyDeep, AppColors.navy],
          stops: [0.0, 1.0],
        ),
      ),
      child: Stack(
        children: [
          // §6.3 — "optional radial accent: rgba(245,166,35,0.08) at top-right
          // for amber bloom". The web client carries the same wash.
          Positioned(
            right: -140,
            top: -170,
            child: Container(
              width: 420,
              height: 420,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0x1FF5A623), // amber at 12%
              ),
            ),
          ),
          // The original decorative circle, kept: it is what stops the panel
          // reading as a flat rectangle on a tall phone.
          if (!compact)
            Positioned(
              right: -160,
              bottom: -180,
              child: Container(
                width: 460,
                height: 460,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0x14FFFFFF), // white at 8%
                ),
              ),
            ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const AuthLogoRow(),
              if (!compact) const SizedBox(height: 36),
              const SizedBox(height: 22),
              Text(
                'Everything your institute runs on, in one place.',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: compact ? 25 : 34,
                  height: 1.15,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.4,
                ),
              ),
              if (!compact) ...[
                const SizedBox(height: 18),
                Text(
                  'Admissions, attendance, coursework, fees and certificates — '
                  'kept in step, so nobody has to reconcile two spreadsheets '
                  'at the end of the month.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 16,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 24),
                const _AuthPoint('Registers, marking and progress that agree with each other'),
                const SizedBox(height: 10),
                const _AuthPoint('Fees, receipts and instalment plans on one ledger'),
                const SizedBox(height: 10),
                const _AuthPoint('Certificates an employer can verify without an account'),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class AuthLogoRow extends StatelessWidget {
  const AuthLogoRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // THE MASTER EMBLEM, not a letter in a rounded box. §2.3:
        // "Recreate the logo from scratch — always use the master asset."
        //
        // No shadow, no tinted plate behind it: §2.3 forbids drop shadows,
        // glows, outlines and filters on the logo, and the old mark sat on a
        // white-at-18% square that was doing all three jobs at once.
        Image.asset(
          'assets/brand/ppship-emblem.png',
          width: 40,
          height: 40,
          // The lockup is decorative here; the wordmark beside it is the name.
          excludeFromSemantics: true,
        ),
        const SizedBox(width: 12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Prepreneurship',
              style: TextStyle(
                fontFamily: AppFonts.display,
                color: Colors.white,
                fontSize: 19,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.57, // §4.3 negative tracking on display
                height: 1.1,
              ),
            ),
            // §1.2 — the tagline, exact punctuation, on every surface.
            Text(
              'Dream. Learn. Earn.',
              style: TextStyle(
                fontFamily: AppFonts.body,
                color: Colors.white.withValues(alpha: 0.76),
                fontSize: 10,
                fontWeight: FontWeight.w500,
                letterSpacing: 1.8, // §4.3 eyebrow tracking
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _AuthPoint extends StatelessWidget {
  const _AuthPoint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.18),
            shape: BoxShape.circle,
          ),
          child: const Text(
            '✓',
            style: TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.92),
              fontSize: 14.5,
              height: 1.45,
            ),
          ),
        ),
      ],
    );
  }
}