import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/formats.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/admin_repository.dart';
import '../../data/models/audit_entry.dart';

class AuditLogPage extends StatelessWidget {
  const AuditLogPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AdminCubit(repository: AdminRepository(api: api))
        ..loadAuditLog()
        ..loadAuditActions(),
      child: const _AuditLogView(),
    );
  }
}

class _AuditLogView extends StatefulWidget {
  const _AuditLogView();

  @override
  State<_AuditLogView> createState() => _AuditLogViewState();
}

class _AuditLogViewState extends State<_AuditLogView> {
  bool _showHelp = false;
  bool _showFilters = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final cubit = context.read<AdminCubit>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Audit log'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            onPressed: () => setState(() => _showHelp = !_showHelp),
            icon: Icon(Icons.help_outline,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600),
          ),
          IconButton(
            onPressed: () => setState(() => _showFilters = !_showFilters),
            icon: Icon(
              _showFilters ? Icons.filter_list_off : Icons.filter_list,
              color: _showFilters
                  ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                  : null,
            ),
          ),
        ],
      ),
      body: BlocBuilder<AdminCubit, AdminState>(
        builder: (context, state) {
          if (state.loadingAudit && state.auditEntries.isEmpty) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 5),
            );
          }

          if (state.auditError != null && state.auditEntries.isEmpty) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load audit log',
                    message: state.auditError!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => cubit.loadAuditLog(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          return Column(
            children: [
              if (_showHelp) _HowItWorksHelp(dark: dark),
              if (_showFilters) _FilterBar(dark: dark),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                child: Row(
                  children: [
                    Text(
                      '${state.auditTotalItems} recorded actions',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: muted,
                      ),
                    ),
                    const Spacer(),
                    if (state.auditActionFilter != null ||
                        state.auditEntityFilter != null)
                      TextButton(
                        onPressed: () {
                          cubit.setAuditActionFilter(null);
                          cubit.setAuditEntityFilter(null);
                        },
                        child: const Text('Clear filters'),
                      ),
                  ],
                ),
              ),
              if (state.auditEntries.isEmpty)
                const Expanded(
                  child: Center(
                    child: Padding(
                      padding: EdgeInsets.all(20),
                      child: Text('No entries match those filters.'),
                    ),
                  ),
                )
              else
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () => cubit.loadAuditLog(),
                    child: ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                      itemCount: state.auditEntries.length,
                      itemBuilder: (context, index) =>
                          _AuditEntryTile(entry: state.auditEntries[index]),
                    ),
                  ),
                ),
              if (state.auditTotalPages > 1)
                _PaginationControls(
                  currentPage: state.auditPage,
                  totalPages: state.auditTotalPages,
                  onPageChanged: (page) => cubit.loadAuditLog(page: page),
                ),
            ],
          );
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
      margin: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Who changed what',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'A permanent record of every change: who, what, when, and what it was before.',
            style: TextStyle(fontSize: 12, color: muted),
          ),
          const SizedBox(height: 8),
          _HelpStep(number: 1, text: 'Search for it — by person, by kind of change, or by date.', dark: dark),
          _HelpStep(number: 2, text: 'Open the entry — the before and the after, side by side.', dark: dark),
          _HelpStep(number: 3, text: 'See who really did it — impersonation shows both users.', dark: dark),
          _HelpStep(number: 4, text: 'Export if you need to — for an inspection or written question.', dark: dark),
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

// ── Filter Bar ──

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final cubit = context.read<AdminCubit>();
    final state = context.watch<AdminCubit>().state;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Action filter
          Text(
            'Action',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Container(
            height: 36,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              border: Border.all(
                color: dark ? AppColorsDark.line : AppColors.line,
              ),
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: state.auditActionFilter,
                isExpanded: true,
                isDense: true,
                hint: Text(
                  'Everything',
                  style: TextStyle(fontSize: 13, color: muted),
                ),
                style: TextStyle(
                  fontSize: 13,
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                ),
                items: [
                  const DropdownMenuItem<String>(
                    value: null,
                    child: Text('Everything'),
                  ),
                  for (final a in state.auditActions)
                    DropdownMenuItem<String>(
                      value: a.action,
                      child: Text('${a.action} (${a.count})'),
                    ),
                ],
                onChanged: (v) => cubit.setAuditActionFilter(v),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Audit Entry Tile ──

class _AuditEntryTile extends StatefulWidget {
  const _AuditEntryTile({required this.entry});
  final AuditEntry entry;

  @override
  State<_AuditEntryTile> createState() => _AuditEntryTileState();
}

class _AuditEntryTileState extends State<_AuditEntryTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final e = widget.entry;

    final diffs = _computeDiff(e.beforeValue, e.afterValue);
    final summaryDiffs = diffs.take(3).toList();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Collapsed header
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: brand.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          e.action,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: brand,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (e.entityType != null)
                        Flexible(
                          child: Text(
                            e.entityType!,
                            style: TextStyle(fontSize: 11.5, color: muted),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      const Spacer(),
                      if (e.impersonatedBy != null)
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: AppColors.warn.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            'impersonating',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                              color: AppColors.warn,
                            ),
                          ),
                        ),
                      Icon(
                        _expanded ? Icons.expand_less : Icons.expand_more,
                        size: 18,
                        color: muted,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      if (e.actor != null) ...[
                        Text(
                          e.actor!,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                        if (e.actorRole != null)
                          Text(
                            ' (${e.actorRole})',
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                      ],
                      const Spacer(),
                      Text(
                        _formatDate(e.occurredAt),
                        style: TextStyle(fontSize: 11.5, color: muted),
                      ),
                    ],
                  ),
                  if (summaryDiffs.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      summaryDiffs.join(' . '),
                      style: TextStyle(fontSize: 11, color: muted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Expanded details
          if (_expanded) ...[
            Divider(
              height: 1,
              color: dark ? AppColorsDark.line : AppColors.line,
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _DetailRow(label: 'Entity', value: '${e.entityType} ${e.entityId}', dark: dark),
                  if (e.ipAddress != null)
                    _DetailRow(label: 'IP', value: e.ipAddress!, dark: dark),
                  if (e.correlationId != null)
                    _DetailRow(label: 'Request ID', value: e.correlationId!, dark: dark),
                  if (e.impersonatedBy != null)
                    _DetailRow(
                      label: 'Impersonated by',
                      value: e.impersonatedBy!,
                      dark: dark,
                      color: AppColors.warn,
                    ),
                  if (diffs.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Changes',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    for (final d in diffs)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 3),
                        child: Text(
                          d,
                          style: TextStyle(
                            fontSize: 11.5,
                            color: muted,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                  ] else ...[
                    const SizedBox(height: 8),
                    Text(
                      'No field values were recorded for this action.',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: muted,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  static List<String> _computeDiff(dynamic before, dynamic after) {
    if (before == null && after == null) return [];
    final b = before is Map<String, dynamic> ? before : <String, dynamic>{};
    final a = after is Map<String, dynamic> ? after : <String, dynamic>{};
    final keys = <String>{...b.keys, ...a.keys};
    final diffs = <String>[];
    for (final k in keys) {
      final bVal = b[k];
      final aVal = a[k];
      final bStr = _renderValue(bVal);
      final aStr = _renderValue(aVal);
      if (bVal == null && aVal != null) {
        diffs.add('$k: $aStr');
      } else if (bVal != null && aVal == null) {
        diffs.add('$k: was $bStr');
      } else if (bStr != aStr) {
        diffs.add('$k: $bStr → $aStr');
      }
    }
    return diffs;
  }

  static String _renderValue(dynamic v) {
    if (v == null) return '—';
    if (v is String) return v.length > 60 ? '${v.substring(0, 57)}...' : v;
    return v.toString();
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

// ── Detail Row ──

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    required this.dark,
    this.color,
  });
  final String label;
  final String value;
  final bool dark;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.only(bottom: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: TextStyle(fontSize: 11, color: muted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 11.5,
                color: color ?? (dark ? AppColorsDark.ink : AppColors.ink),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Pagination ──

class _PaginationControls extends StatelessWidget {
  const _PaginationControls({
    required this.currentPage,
    required this.totalPages,
    required this.onPageChanged,
  });
  final int currentPage;
  final int totalPages;
  final ValueChanged<int> onPageChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            onPressed: currentPage > 1
                ? () => onPageChanged(currentPage - 1)
                : null,
            icon: const Icon(Icons.chevron_left, size: 20),
          ),
          Text(
            'Page $currentPage of $totalPages',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: brand,
            ),
          ),
          IconButton(
            onPressed: currentPage < totalPages
                ? () => onPageChanged(currentPage + 1)
                : null,
            icon: const Icon(Icons.chevron_right, size: 20),
          ),
        ],
      ),
    );
  }
}
