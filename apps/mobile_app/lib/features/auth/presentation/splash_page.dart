import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

/// "Checking your session…" — shown only while the stored refresh token is
/// being verified against /auth/me. It distinguishes session restoration from
/// being signed out, so a returning user never sees a login flash.
class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppColors.brand600, AppColors.brand800],
                ),
                boxShadow: AppShadow.soft,
              ),
              alignment: Alignment.center,
              child: const Text(
                'P',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Prepreneurship',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const Text(
              'LEARNING',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                letterSpacing: 2,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 32),
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
            const SizedBox(height: 14),
            const Text(
              'Checking your session…',
              style: TextStyle(color: AppColors.muted, fontSize: 14),
            ),
          ],
        ),
      ),
    );
  }
}