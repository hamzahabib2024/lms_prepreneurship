import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/security_event.dart';

class SecurityPage extends StatelessWidget {
  const SecurityPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))
        ..loadSecurityOverview()
        ..loadSecurityEvents(),
      child: const _SecurityView(),
    );
  }
}

class _SecurityView extends StatelessWidget {
  const _SecurityView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Security log'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<AdminCubit, AdminState>(
        builder: (context, state) {
          if (state.loadingSecurity) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          }

          if (state.securityError != null && state.securityOverview == null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load security data',
                    message: state.securityError!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () {
                      context.read<AdminCubit>().loadSecurityOverview();
                      context.read<AdminCubit>().loadSecurityEvents();
                    },
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              await context.read<AdminCubit>().loadSecurityOverview();
              if (!context.mounted) return;
              await context.read<AdminCubit>().loadSecurityEvents();
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                if (state.securityOverview != null) ...[
                  _OverviewCard(overview: state.securityOverview!),
                  const SizedBox(height: 16),
                ],
                Text('Recent events', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                if (state.loadingSecurityEvents)
                  const SkeletonCards(count: 3)
                else if (state.securityEvents.isEmpty)
                  Text(
                    'No security events in the last 24 hours.',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontSize: 13.5,
                    ),
                  )
                else
                  for (final event in state.securityEvents)
                    _SecurityEventTile(event: event),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _OverviewCard extends StatelessWidget {
  const _OverviewCard({required this.overview});

  final SecurityOverview overview;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ok = dark ? AppColorsDark.ok : AppColors.ok;
    final warn = dark ? AppColorsDark.warn : AppColors.warn;
    final error = dark ? AppColorsDark.error : AppColors.error;

    final tally = overview.tally;
    final signIns = tally['signIns'] as int? ?? 0;
    final failures = tally['failures'] as int? ?? 0;
    final lockouts = tally['lockouts'] as int? ?? 0;
    final tokenReuse = tally['tokenReuse'] as int? ?? 0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Last ${overview.windowHours}h',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const Spacer(),
              if (overview.concerns.isNotEmpty)
                Pill(text: '${overview.concerns.length} concern${overview.concerns.length == 1 ? '' : 's'}', kind: PillKind.warn)
              else
                Pill(text: 'All clear', kind: PillKind.ok),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _TallyItem(label: 'Sign-ins', value: signIns, color: ok)),
              const SizedBox(width: 8),
              Expanded(child: _TallyItem(label: 'Failures', value: failures, color: failures > 0 ? warn : muted)),
              const SizedBox(width: 8),
              Expanded(child: _TallyItem(label: 'Lockouts', value: lockouts, color: lockouts > 0 ? error : muted)),
              const SizedBox(width: 8),
              Expanded(child: _TallyItem(label: 'Token reuse', value: tokenReuse, color: tokenReuse > 0 ? error : muted)),
            ],
          ),
          if (overview.concerns.isNotEmpty) ...[
            const SizedBox(height: 14),
            for (final concern in overview.concerns)
              _ConcernTile(concern: concern),
          ],
          if (overview.message != null) ...[
            const SizedBox(height: 10),
            Text(overview.message!, style: TextStyle(fontSize: 12.5, color: muted)),
          ],
        ],
      ),
    );
  }
}

class _TallyItem extends StatelessWidget {
  const _TallyItem({required this.label, required this.value, required this.color});

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          '$value',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color),
        ),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 10.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

class _ConcernTile extends StatelessWidget {
  const _ConcernTile({required this.concern});

  final SecurityConcern concern;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final warn = dark ? AppColorsDark.warn : AppColors.warn;
    final error = dark ? AppColorsDark.error : AppColors.error;

    final color = switch (concern.severity) {
      'CRITICAL' => error,
      'HIGH' => warn,
      _ => dark ? AppColorsDark.muted : AppColors.muted,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Pill(text: concern.severity),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  concern.headline,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color),
                ),
              ),
            ],
          ),
          if (concern.advice != null) ...[
            const SizedBox(height: 4),
            Text(concern.advice!, style: TextStyle(fontSize: 12, color: dark ? AppColorsDark.muted : AppColors.muted)),
          ],
        ],
      ),
    );
  }
}

class _SecurityEventTile extends StatelessWidget {
  const _SecurityEventTile({required this.event});

  final SecurityEvent event;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final isFailure = event.eventType.contains('failed');

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isFailure ? Icons.warning_amber_outlined : Icons.check_circle_outline,
            size: 18,
            color: isFailure
                ? (dark ? AppColorsDark.warn : AppColors.warn)
                : (dark ? AppColorsDark.ok : AppColors.ok),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.eventType,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
                if (event.email != null || event.who != null)
                  Text(
                    event.who ?? event.email ?? '',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                if (event.ipAddress != null)
                  Text(
                    'IP: ${event.ipAddress}',
                    style: TextStyle(fontSize: 11, color: muted),
                  ),
              ],
            ),
          ),
          Flexible(
            child: Text(
              _formatDate(event.occurredAt),
              style: TextStyle(fontSize: 11, color: muted),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  static String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}
