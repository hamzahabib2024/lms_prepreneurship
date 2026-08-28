import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/formats.dart';
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
      )..load()
       ..loadOutbox(),
      child: const _IntegrationsView(),
    );
  }
}

class _IntegrationsView extends StatefulWidget {
  const _IntegrationsView();

  @override
  State<_IntegrationsView> createState() => _IntegrationsViewState();
}

class _IntegrationsViewState extends State<_IntegrationsView> {
  bool _showHelp = false;
  bool _showOutbox = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final cubit = context.read<IntegrationsCubit>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Integrations'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            onPressed: () => setState(() => _showHelp = !_showHelp),
            icon: Icon(Icons.help_outline,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600),
          ),
        ],
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
                    onPressed: () => cubit.load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case IntegrationsStatus.loaded:
              final simulated = state.items.where((r) => !r.isLive).toList();
              return RefreshIndicator(
                onRefresh: () => cubit.load(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    if (_showHelp) _HowItWorksHelp(dark: dark),
                    if (simulated.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: AppAlert(
                          title:
                              '${simulated.length} of ${state.items.length} integrations are not live',
                          message:
                              'Everything still works — but nothing is being sent externally. '
                              'Messages are held in the simulated outbox until the channel is configured.',
                          warn: true,
                        ),
                      ),
                    for (final item in state.items)
                      _IntegrationCard(status: item),
                    const SizedBox(height: 16),
                    _OutboxSection(
                      state: state,
                      showOutbox: _showOutbox,
                      onToggle: () => setState(() => _showOutbox = !_showOutbox),
                      dark: dark,
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

// ── HowItWorks Panel ──

class _HowItWorksHelp extends StatelessWidget {
  const _HowItWorksHelp({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Connecting Google and email',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          _HelpStep(number: 1, text: 'See what is connected — each card shows whether a service is live or simulated.', dark: dark),
          _HelpStep(number: 2, text: 'Simulated means safe — nothing is sent externally. Messages are held in the outbox.', dark: dark),
          _HelpStep(number: 3, text: 'To go live — follow the instructions on each card to configure the real service.', dark: dark),
          _HelpStep(number: 4, text: 'Check the outbox — see what would have been sent if the service were live.', dark: dark),
          const SizedBox(height: 6),
          Text(
            'Simulated services are safe for trying things out.',
            style: TextStyle(fontSize: 11, color: muted, fontStyle: FontStyle.italic),
          ),
        ],
      ),
    );
  }
}

class _HelpStep extends StatelessWidget {
  const _HelpStep({
    required this.number,
    required this.text,
    required this.dark,
  });
  final int number;
  final String text;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$number.',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              fontSize: 12,
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 11, color: muted)),
          ),
        ],
      ),
    );
  }
}

// ── Integration Card ──

class _IntegrationCard extends StatelessWidget {
  const _IntegrationCard({required this.status});
  final IntegrationStatus status;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    final (pillText, pillColor) = switch (status.mode) {
      'LIVE' => ('Live', AppColors.ok),
      'SIMULATED' => ('Simulated', AppColors.warn),
      _ => ('Not configured', muted),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  status.name,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: pillColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  pillText,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: pillColor,
                  ),
                ),
              ),
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
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
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

// ── Outbox Section ──

class _OutboxSection extends StatelessWidget {
  const _OutboxSection({
    required this.state,
    required this.showOutbox,
    required this.onToggle,
    required this.dark,
  });

  final IntegrationsState state;
  final bool showOutbox;
  final VoidCallback onToggle;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final cubit = context.read<IntegrationsCubit>();

    return Container(
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(
                      Icons.outbox_outlined,
                      size: 18,
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Simulated Outbox',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: ink,
                            ),
                          ),
                          if (state.outbox != null)
                            Text(
                              '${state.outbox!.held} message${state.outbox!.held == 1 ? '' : 's'} held',
                              style: TextStyle(fontSize: 12, color: muted),
                            ),
                        ],
                      ),
                    ),
                    if (state.outbox != null && state.outbox!.held > 0)
                      TextButton(
                        onPressed: () => _confirmClear(context, cubit),
                        child: const Text('Clear'),
                      ),
                    Icon(
                      showOutbox ? Icons.expand_less : Icons.expand_more,
                      color: muted,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (showOutbox) ...[
            Divider(
              height: 1,
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
            if (state.loadingOutbox)
              const Padding(
                padding: EdgeInsets.all(20),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (state.outbox == null || state.outbox!.messages.isEmpty)
              Padding(
                padding: const EdgeInsets.all(20),
                child: Center(
                  child: Text(
                    'No simulated messages.',
                    style: TextStyle(fontSize: 13, color: muted),
                  ),
                ),
              )
            else
              for (final msg in state.outbox!.messages)
                _OutboxMessageTile(message: msg, dark: dark),
            if (state.outbox?.note != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: Text(
                  state.outbox!.note,
                  style: TextStyle(
                    fontSize: 11,
                    color: muted,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }

  void _confirmClear(BuildContext context, IntegrationsCubit cubit) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear the simulated outbox?'),
        content: const Text('Nothing real is affected.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              cubit.clearOutbox();
            },
            child: const Text('Clear'),
          ),
        ],
      ),
    );
  }
}

// ── Outbox Message Tile ──

class _OutboxMessageTile extends StatefulWidget {
  const _OutboxMessageTile({required this.message, required this.dark});
  final OutboxMessage message;
  final bool dark;

  @override
  State<_OutboxMessageTile> createState() => _OutboxMessageTileState();
}

class _OutboxMessageTileState extends State<_OutboxMessageTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final dark = widget.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final m = widget.message;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: (dark ? AppColorsDark.line : AppColors.line).withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          m.recipientName,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                        if (m.isUrgent) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 4, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppColors.error.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'Urgent',
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w700,
                                color: AppColors.error,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${m.channel} · ${m.title}',
                      style: TextStyle(fontSize: 12, color: muted),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _formatDate(m.at),
                    style: TextStyle(fontSize: 11, color: muted),
                  ),
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: () => setState(() => _expanded = !_expanded),
                    child: Text(
                      _expanded ? 'Hide' : 'Read',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (_expanded) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                m.body,
                style: TextStyle(fontSize: 12.5, color: ink),
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${Formats.shortDate(dt)} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}
