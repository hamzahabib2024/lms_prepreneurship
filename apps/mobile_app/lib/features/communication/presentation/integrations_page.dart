import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/integrations_cubit.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class IntegrationsPage extends StatelessWidget {
  const IntegrationsPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => IntegrationsCubit(
        repository: CommunicationRepository(api: api),
      )..load(),
      child: const _IntegrationsView(),
    );
  }
}

class _IntegrationsView extends StatelessWidget {
  const _IntegrationsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Integrations'),
      ),
      body: BlocBuilder<IntegrationsCubit, IntegrationsState>(
        builder: (context, state) {
          switch (state.status) {
            case IntegrationsStatus.loading:
              return const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 3),
              );
            case IntegrationsStatus.failure:
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  AppAlert(
                    title: 'Could not load integrations',
                    message: state.error?.message ?? 'Something went wrong.',
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<IntegrationsCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case IntegrationsStatus.loaded:
              final simulated =
                  state.items.where((r) => !r.isLive).toList();
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<IntegrationsCubit>().load(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    if (simulated.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: AppAlert(
                          title:
                              '${simulated.length} of ${state.items.length} integrations are not live',
                          message:
                              'Everything still works \u2014 but nothing is being sent externally. '
                              'Messages are held in the system until the channel is configured.',
                          warn: true,
                        ),
                      ),
                    for (final item in state.items)
                      _IntegrationCard(status: item),
                  ],
                ),
              );
          }
        },
      ),
    );
  }
}

class _IntegrationCard extends StatelessWidget {
  const _IntegrationCard({required this.status});

  final IntegrationStatus status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    final (pillText, pillColor) = switch (status.mode) {
      'LIVE' => ('Live', AppColors.ok),
      'SIMULATED' => ('Simulated', AppColors.warn),
      _ => ('Not configured', muted),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  status.name,
                  style: theme.textTheme.titleSmall,
                ),
              ),
              Pill(text: pillText),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            status.behaviour,
            style: TextStyle(fontSize: 13.5, color: muted),
          ),
          if (status.toGoLive != null) ...[
            const SizedBox(height: 12),
            Text(
              'To go live',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: muted,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              status.toGoLive!,
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],
          if (status.dependency != null) ...[
            const SizedBox(height: 8),
            Text(
              'Blocked on ${status.dependency}.',
              style: TextStyle(fontSize: 12, color: muted),
            ),
          ],
        ],
      ),
    );
  }
}
