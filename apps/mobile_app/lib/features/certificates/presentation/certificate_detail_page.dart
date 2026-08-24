import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_theme.dart';
import '../data/models/certificate.dart';

/// Detail view for a single certificate — shows all snapshot data,
/// revocation info if applicable, and the verification link.
class CertificateDetailPage extends StatelessWidget {
  const CertificateDetailPage({super.key, required this.certificate});

  final Certificate certificate;

  static const _verifyBaseUrl = 'https://ppship.org/verify';

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final issued = certificate.isIssued;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Certificate'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Status banner
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: issued ? AppColors.okBg : AppColors.errorBg,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Row(
              children: [
                Icon(
                  issued ? Icons.verified : Icons.cancel_outlined,
                  size: 28,
                  color: issued ? AppColors.ok : AppColors.error,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        issued ? 'Certificate Valid' : 'Certificate Revoked',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: issued ? AppColors.ok : AppColors.error,
                        ),
                      ),
                      if (!issued && certificate.revocationReason != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            certificate.revocationReason!,
                            style: TextStyle(
                              fontSize: 13,
                              color: AppColors.error.withValues(alpha: 0.8),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Certificate number
          _DetailRow(
            label: 'Certificate No.',
            value: certificate.certificateNo,
            bold: true,
          ),
          const SizedBox(height: 12),

          // Type
          _DetailRow(
            label: 'Type',
            value: certificate.isSubject ? 'Subject Certificate' : 'Programme Certificate',
          ),
          const SizedBox(height: 12),

          // Awarded for
          _DetailRow(
            label: 'Awarded for',
            value: certificate.awardedFor,
          ),
          const SizedBox(height: 12),

          // Issue date
          _DetailRow(
            label: 'Issued on',
            value: _formatDate(certificate.issuedAt),
          ),

          // Revocation info
          if (certificate.isRevoked) ...[
            const SizedBox(height: 12),
            if (certificate.revokedAt != null)
              _DetailRow(
                label: 'Revoked on',
                value: _formatDate(certificate.revokedAt!),
              ),
          ],

          // Progress snapshot
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: dark ? AppColorsDark.surface2 : AppColors.surface2,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Performance at issuance',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: muted,
                  ),
                ),
                const SizedBox(height: 10),
                _ProgressRow(
                  label: 'Overall progress',
                  percent: certificate.progressPercent,
                ),
                if (certificate.attendancePercent != null) ...[
                  const SizedBox(height: 6),
                  _ProgressRow(
                    label: 'Attendance',
                    percent: certificate.attendancePercent!,
                  ),
                ],
                if (certificate.averageGradePercent != null) ...[
                  const SizedBox(height: 6),
                  _ProgressRow(
                    label: 'Average grade',
                    percent: certificate.averageGradePercent!,
                  ),
                ],
              ],
            ),
          ),

          // Verification section
          if (issued && certificate.verificationCode.isNotEmpty) ...[
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Verification',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Employers can verify this certificate without an account.',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.surface,
                            borderRadius:
                                BorderRadius.circular(AppRadius.sm),
                          ),
                          child: Text(
                            '$_verifyBaseUrl/${certificate.verificationCode}',
                            style: const TextStyle(
                              fontSize: 11.5,
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: () {
                          Clipboard.setData(
                            ClipboardData(
                              text:
                                  '$_verifyBaseUrl/${certificate.verificationCode}',
                            ),
                          );
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Verification link copied.'),
                              duration: Duration(seconds: 2),
                            ),
                          );
                        },
                        icon: const Icon(Icons.copy, size: 18),
                        tooltip: 'Copy verification link',
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatDate(String iso) {
    final date = DateTime.tryParse(iso);
    if (date == null) return iso;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day} ${months[date.month - 1]} ${date.year}';
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value, this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: TextStyle(fontSize: 13, color: muted),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}

class _ProgressRow extends StatelessWidget {
  const _ProgressRow({required this.label, required this.percent});

  final String label;
  final double percent;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 12, color: muted)),
              const SizedBox(height: 3),
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: (percent / 100).clamp(0.0, 1.0),
                  minHeight: 5,
                  backgroundColor:
                      Theme.of(context).colorScheme.surfaceContainerHighest,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        Text(
          '${percent.toStringAsFixed(0)}%',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}
