import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/email_queue_cubit.dart';
import '../../data/email_queue_repository.dart';
import '../../data/models/email_queue_item.dart';
import '../../data/models/email_queue_usage.dart';

class EmailQueuePage extends StatelessWidget {
  const EmailQueuePage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => EmailQueueCubit(
        repository: EmailQueueRepository(api: api),
      )..load(),
      child: const _EmailQueueView(),
    );
  }
}

class _EmailQueueView extends StatelessWidget {
  const _EmailQueueView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Outgoing email'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocConsumer<EmailQueueCubit, EmailQueueState>(
        listenWhen: (prev, curr) =>
            prev.actionSuccess != curr.actionSuccess ||
            prev.actionError != curr.actionError,
        listener: (context, state) {
          if (state.actionSuccess != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionSuccess!)),
            );
            context.read<EmailQueueCubit>().dismissResult();
          }
          if (state.actionError != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.actionError!.message)),
            );
            context.read<EmailQueueCubit>().dismissResult();
          }
        },
        builder: (context, state) {
          if (state.loading && state.summary == null) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }

          if (state.error != null && state.summary == null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load the email queue',
                    message: state.error!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<EmailQueueCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          final summary = state.summary;
          if (summary == null) return const SizedBox.shrink();

          return RefreshIndicator(
            onRefresh: () => context.read<EmailQueueCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                _Description(requiresApproval: summary.requiresApproval),
                const SizedBox(height: 14),
                _Allowance(usage: summary.usage),
                const SizedBox(height: 14),
                _KpiRow(
                  awaitingApproval: summary.awaitingApproval,
                  retrying: summary.retrying,
                  sentToday: summary.sentToday,
                  abandoned: summary.abandoned,
                ),
                const SizedBox(height: 14),
                _WaitingSection(
                  items: state.waiting,
                  selectedIds: state.selectedIds,
                  busy: state.busy,
                  requiresApproval: summary.requiresApproval,
                ),
                if (state.retrying.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  _RetryingSection(items: state.retrying),
                ],
                if (state.abandoned.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  _AbandonedSection(items: state.abandoned),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Description extends StatelessWidget {
  const _Description({required this.requiresApproval});

  final bool requiresApproval;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Text(
      requiresApproval
          ? 'Account email is held here until somebody releases it.'
          : 'Account email is sent as soon as it is written. Anything below is waiting on the mail server, not on you.',
      style: TextStyle(fontSize: 13, color: muted),
    );
  }
}

class _Allowance extends StatelessWidget {
  const _Allowance({required this.usage});

  final EmailQueueUsage usage;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final nearlyOut =
        !usage.blocked && usage.limit > 0 && usage.percentUsed >= 80;

    return Column(
      children: [
        if (usage.blocked)
          AppAlert(
            title: 'The sending account is out of its daily allowance.',
            message:
                'The mail server refused a message'
                '${usage.blockedSince != null ? ' at ${_formatTime(usage.blockedSince!)}' : ''}'
                ' with "Daily user sending limit exceeded". Nothing is wrong with the addresses or the settings.',
            warn: true,
          ),
        if (nearlyOut)
          AppAlert(
            title:
                'About ${usage.percentUsed.round()}% of the day\'s sending allowance has been used.',
            message:
                'Roughly ${usage.remaining} left of ${usage.limit}. A large import today may not all get through.',
            warn: true,
          ),
        if (usage.blocked || nearlyOut) const SizedBox(height: 10),
        _WidgetCard(
          title: 'Sending allowance',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _AllowanceFigures(usage: usage),
              const SizedBox(height: 12),
              _UsageBar(percent: usage.percentUsed),
              const SizedBox(height: 8),
              Text(
                'An estimate, and always low. It counts what this System sent.',
                style: TextStyle(fontSize: 11.5, color: muted),
              ),
              if (usage.byKind.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  'What used it',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
                const SizedBox(height: 6),
                for (final k in usage.byKind)
                  ListRow(
                    title: k.label,
                    trailing: Text(
                      '${k.sent}${usage.sent > 0 ? ' (${((k.sent / usage.sent) * 100).round()}%)' : ''}',
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _AllowanceFigures extends StatelessWidget {
  const _AllowanceFigures({required this.usage});

  final EmailQueueUsage usage;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      children: [
        _AllowanceItem(
          label: 'Sent (24h)',
          value: '${usage.sent}',
          note: 'estimate',
        ),
        const SizedBox(width: 12),
        _AllowanceItem(
          label: 'Allowance',
          value: '${usage.limit}',
          note: 'daily limit',
        ),
        const SizedBox(width: 12),
        _AllowanceItem(
          label: 'Refused',
          value: '${usage.failed}',
          note: 'in same period',
        ),
      ],
    );
  }
}

class _AllowanceItem extends StatelessWidget {
  const _AllowanceItem({
    required this.label,
    required this.value,
    this.note,
  });

  final String label;
  final String value;
  final String? note;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 11, color: muted),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (note != null)
            Text(
              note!,
              style: TextStyle(fontSize: 10, color: muted),
            ),
        ],
      ),
    );
  }
}

class _UsageBar extends StatelessWidget {
  const _UsageBar({required this.percent});

  final double percent;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final track = dark ? AppColorsDark.surface2 : AppColors.surface2;
    final fill = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Container(
            height: 8,
            color: track,
            child: FractionallySizedBox(
              widthFactor: (percent / 100).clamp(0.0, 1.0),
              child: Container(color: fill),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '${percent.round()}% used',
          style: TextStyle(fontSize: 11, color: muted),
        ),
      ],
    );
  }
}

class _KpiRow extends StatelessWidget {
  const _KpiRow({
    required this.awaitingApproval,
    required this.retrying,
    required this.sentToday,
    required this.abandoned,
  });

  final int awaitingApproval;
  final int retrying;
  final int sentToday;
  final int abandoned;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _KpiItem(
          value: '$awaitingApproval',
          label: 'Waiting for you',
          warn: awaitingApproval > 0,
        ),
        const SizedBox(width: 10),
        _KpiItem(
          value: '$retrying',
          label: 'Mail server',
        ),
        const SizedBox(width: 10),
        _KpiItem(
          value: '$sentToday',
          label: 'Sent today',
        ),
        const SizedBox(width: 10),
        _KpiItem(
          value: '$abandoned',
          label: 'Given up',
          warn: abandoned > 0,
        ),
      ],
    );
  }
}

class _KpiItem extends StatelessWidget {
  const _KpiItem({
    required this.value,
    required this.label,
    this.warn = false,
  });

  final String value;
  final String label;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;

    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          border: Border.all(
            color: warn
                ? warnColor.withValues(alpha: 0.4)
                : (dark ? AppColorsDark.line : AppColors.line),
          ),
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Column(
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: warn ? warnColor : null,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                color: muted,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _WaitingSection extends StatelessWidget {
  const _WaitingSection({
    required this.items,
    required this.selectedIds,
    required this.busy,
    required this.requiresApproval,
  });

  final List<EmailQueueItem> items;
  final Set<String> selectedIds;
  final bool busy;
  final bool requiresApproval;

  @override
  Widget build(BuildContext context) {
    return _WidgetCard(
      title: 'Waiting for you (${items.length})',
      trailing: items.isNotEmpty
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (selectedIds.isNotEmpty)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => context
                            .read<EmailQueueCubit>()
                            .approveSelected(selectedIds.toList()),
                    child: Text('Release ${selectedIds.length}'),
                  ),
                FilledButton(
                  onPressed: busy
                      ? null
                      : () =>
                          context.read<EmailQueueCubit>().approveAll(),
                  child: busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text('Release all ${items.length}'),
                ),
              ],
            )
          : null,
      child: items.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: Text(
                  requiresApproval
                      ? 'Every message written so far has been dealt with.'
                      : 'Account email is going out immediately — nothing is being held for approval.',
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          : Column(
              children: [
                if (items.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        TextButton(
                          onPressed: () {
                            final cubit =
                                context.read<EmailQueueCubit>();
                            if (selectedIds.length == items.length) {
                              cubit.clearSelection();
                            } else {
                              cubit.selectAll(items.map((e) => e.id).toList());
                            }
                          },
                          child: Text(
                            selectedIds.length == items.length
                                ? 'Deselect all'
                                : 'Select all',
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        if (selectedIds.isNotEmpty)
                          TextButton(
                            onPressed: busy
                                ? null
                                : () => _confirmDiscard(
                                    context, selectedIds.toList()),
                            child: Text(
                              'Discard ${selectedIds.length}',
                              style: TextStyle(
                                fontSize: 12,
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                for (final item in items)
                  _WaitingRow(
                    item: item,
                    selected: selectedIds.contains(item.id),
                    onToggle: () =>
                        context.read<EmailQueueCubit>().toggleSelection(item.id),
                  ),
              ],
            ),
    );
  }

  void _confirmDiscard(BuildContext context, List<String> ids) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Discard ${ids.length} message${ids.length == 1 ? '' : 's'}?'),
        content: const Text(
          'They will never be sent. The record is kept so you can see later that this was a decision rather than a fault.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<EmailQueueCubit>().discardSelected(ids);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
  }
}

class _WaitingRow extends StatelessWidget {
  const _WaitingRow({
    required this.item,
    required this.selected,
    required this.onToggle,
  });

  final EmailQueueItem item;
  final bool selected;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return InkWell(
      onTap: onToggle,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: selected,
              onChanged: (_) => onToggle(),
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.fullName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.toAddress,
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.displaySubject,
                    style: const TextStyle(fontSize: 13),
                  ),
                  if (item.kind == 'CREDENTIALS') ...[
                    const SizedBox(height: 2),
                    Text(
                      'Sends a link to choose a password, not the temporary one.',
                      style: TextStyle(fontSize: 11, color: muted),
                    ),
                  ],
                  const SizedBox(height: 2),
                  Text(
                    _formatTime(item.createdAt),
                    style: TextStyle(fontSize: 11, color: muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RetryingSection extends StatelessWidget {
  const _RetryingSection({required this.items});

  final List<EmailQueueItem> items;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return _WidgetCard(
      title: 'Waiting for the mail server (${items.length})',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Released or sent automatically, and refused by the mail server for now — almost always the daily sending limit. Nothing to do. These are retried again every half hour until they go.',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 8),
          for (final item in items)
            ListRow(
              title: item.fullName,
              subtitle:
                  '${item.attempts} attempt${item.attempts == 1 ? '' : 's'} · next at ${_formatTime(item.nextAttemptAt)}',
            ),
        ],
      ),
    );
  }
}

class _AbandonedSection extends StatelessWidget {
  const _AbandonedSection({required this.items});

  final List<EmailQueueItem> items;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return _WidgetCard(
      title: 'Given up on (${items.length})',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'These will not be sent. Tell these people yourself — the temporary passwords are on the import result, or reset the account to have new details sent.',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 8),
          for (final item in items)
            ListRow(
              title: item.fullName,
              subtitle: item.lastError ?? 'No reason recorded.',
            ),
        ],
      ),
    );
  }
}

class _WidgetCard extends StatelessWidget {
  const _WidgetCard({
    required this.title,
    required this.child,
    this.trailing,
  });

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                if (trailing != null) trailing!,
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
            child: child,
          ),
        ],
      ),
    );
  }
}

String _formatTime(String iso) {
  try {
    final dt = DateTime.parse(iso).toLocal();
    return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  } catch (_) {
    return iso;
  }
}
