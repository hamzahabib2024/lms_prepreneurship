import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class ImpersonationBanner extends StatelessWidget {
  const ImpersonationBanner({
    super.key,
    required this.originalUserName,
    required this.impersonatedUserName,
    required this.onEndSession,
  });

  final String originalUserName;
  final String impersonatedUserName;
  final VoidCallback onEndSession;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: dark
          ? const Color(0xFF1A1A2E)
          : const Color(0xFFFFF3CD),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            Icon(
              Icons.warning_amber_rounded,
              size: 18,
              color: dark ? AppColorsDark.warn : AppColors.warn,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Viewing as $impersonatedUserName',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                    ),
                  ),
                  Text(
                    'Signed in as $originalUserName',
                    style: TextStyle(
                      fontSize: 11,
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: onEndSession,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                'End session',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: dark ? AppColorsDark.warn : AppColors.warn,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
