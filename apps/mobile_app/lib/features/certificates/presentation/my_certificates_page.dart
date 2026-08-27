import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/my_certificates_cubit.dart';
import '../data/certificates_repository.dart';
import '../data/models/certificate.dart';
import 'certificate_detail_page.dart';

/// The student's certificate list — FR-CRT-008.
///
/// Shows all certificates the student holds, with status, certificate
/// number, and issue date. Tap to see details and copy the verification
/// link.
class MyCertificatesPage extends StatelessWidget {
  const MyCertificatesPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => MyCertificatesCubit(
        repository: CertificatesRepository(api: api),
      )..load(),
      child: const _MyCertificatesView(),
    );
  }
}

class _MyCertificatesView extends StatelessWidget {
  const _MyCertificatesView();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Certificates'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<MyCertificatesCubit, MyCertificatesState>(
        builder: (context, state) {
          switch (state.status) {
            case MyCertificatesStatus.loading:
              return const SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
                child: SkeletonCards(count: 3),
              );
            case MyCertificatesStatus.failure:
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  AppAlert(
                    title: 'Could not load certificates',
                    message:
                        state.error?.message ?? 'Something went wrong.',
                    reference: state.error?.reference,
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<MyCertificatesCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case MyCertificatesStatus.loaded:
              final certs = state.certificates;
              if (certs.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.emoji_events_outlined,
                            size: 48, color: muted),
                        const SizedBox(height: 12),
                        Text(
                          'No certificates yet.',
                          style: TextStyle(color: muted, fontSize: 14),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Certificates will appear here once issued.',
                          style: TextStyle(color: muted, fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<MyCertificatesCubit>().load(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    // Summary
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        '${certs.length} certificate${certs.length == 1 ? '' : 's'}'
                        ' · ${state.issuedCount} valid',
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                    ),
                    for (final cert in certs)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _CertificateCard(certificate: cert),
                      ),
                  ],
                ),
              );
          }
        },
      ),
    );
  }
}

class _CertificateCard extends StatelessWidget {
  const _CertificateCard({required this.certificate});

  final Certificate certificate;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final issued = certificate.isIssued;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: issued
              ? (dark ? AppColorsDark.ok : AppColors.ok)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => CertificateDetailPage(
                  certificate: certificate,
                ),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                // Certificate icon
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: issued
                        ? AppColors.okBg
                        : (dark ? AppColorsDark.surface2 : AppColors.surface2),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Icon(
                    issued
                        ? Icons.emoji_events
                        : Icons.emoji_events_outlined,
                    size: 22,
                    color: issued
                        ? AppColors.ok
                        : (dark ? AppColorsDark.muted : AppColors.muted),
                  ),
                ),
                const SizedBox(width: 12),

                // Certificate info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        certificate.awardedFor,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        certificate.certificateNo,
                        style: TextStyle(
                          fontSize: 12.5,
                          color: muted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatDate(certificate.issuedAt),
                        style: TextStyle(fontSize: 11.5, color: muted),
                      ),
                    ],
                  ),
                ),

                // Status
                const SizedBox(width: 8),
                Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: issued ? AppColors.okBg : AppColors.errorBg,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        issued ? 'Valid' : 'Revoked',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: issued ? AppColors.ok : AppColors.error,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _formatDate(String iso) {
    final date = DateTime.tryParse(iso);
    if (date == null) return iso;
    return Formats.shortDate(date);
  }
}
