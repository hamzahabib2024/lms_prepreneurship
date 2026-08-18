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
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.brand800, AppColors.brand600, Color(0xFF6D28D9)],
          stops: [0.0, 0.55, 1.0],
        ),
      ),
      child: Stack(
        children: [
          // The web's decorative wash: a soft circle bleeding off the corner.
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
        Container(
          width: 36,
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.18),
            borderRadius: BorderRadius.circular(9),
          ),
          child: const Text(
            'P',
            style: TextStyle(
              color: Colors.white,
              fontSize: 19,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
        ),
        const SizedBox(width: 10),
        const Text(
          'Prepreneurship',
          style: TextStyle(
            color: Colors.white,
            fontSize: 19,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.3,
          ),
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