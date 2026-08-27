import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/reports_catalogue_cubit.dart';
import '../cubit/report_runner_cubit.dart';
import '../data/reporting_repository.dart';
import '../data/models/models.dart';

class ReportsPage extends StatelessWidget {
  const ReportsPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final repository = ReportingRepository(api: api);
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) =>
              ReportsCatalogueCubit(repository: repository)..load(),
        ),
        BlocProvider(
          create: (_) => ReportRunnerCubit(repository: repository),
        ),
      ],
      child: const _ReportsView(),
    );
  }
}

class _ReportsView extends StatelessWidget {
  const _ReportsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: BlocBuilder<ReportsCatalogueCubit, ReportsCatalogueState>(
        builder: (context, state) {
          switch (state.status) {
            case ReportsCatalogueStatus.loading:
              return const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 4),
              );
            case ReportsCatalogueStatus.failure:
              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  AppAlert(
                    title: 'Could not load reports',
                    message: state.error?.message ?? 'Something went wrong.',
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<ReportsCatalogueCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case ReportsCatalogueStatus.loaded:
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<ReportsCatalogueCubit>().load(),
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        '${state.reports.length} available to you',
                        style: TextStyle(
                          fontSize: 13.5,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    for (final report in state.reports)
                      _ReportCard(
                        report: report,
                        sections: state.sections,
                      ),
                    // Result area
                    BlocBuilder<ReportRunnerCubit, ReportRunnerState>(
                      buildWhen: (prev, curr) =>
                          prev.status != curr.status ||
                          prev.result != curr.result,
                      builder: (context, runner) {
                        if (runner.status == ReportRunnerStatus.idle &&
                            runner.result == null) {
                          return const SizedBox.shrink();
                        }
                        return _ResultArea(runner: runner);
                      },
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

// --------------------------------------------------------------- Report Card --

class _ReportCard extends StatefulWidget {
  const _ReportCard({required this.report, required this.sections});

  final ReportDefinition report;
  final List<ReportSection> sections;

  @override
  State<_ReportCard> createState() => _ReportCardState();
}

class _ReportCardState extends State<_ReportCard> {
  final Map<String, String> _filters = {};

  bool get _hasMissingRequired {
    for (final spec in widget.report.filters) {
      if (spec.required && (_filters[spec.key] ?? '').isEmpty) {
        return true;
      }
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final runnerState = context.watch<ReportRunnerCubit>().state;
    final isRunning =
        runnerState.status == ReportRunnerStatus.running &&
        runnerState.currentKey == widget.report.key;

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
          Text(widget.report.name, style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(
            widget.report.description,
            style: TextStyle(fontSize: 13, color: muted),
          ),

          // Filters
          for (final spec in widget.report.filters) ...[
            const SizedBox(height: 12),
            _buildFilter(spec, muted),
          ],

          // Missing required hint
          if (_hasMissingRequired)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Choose required filters first.',
                style: TextStyle(fontSize: 12.5, color: AppColors.warn),
              ),
            ),

          const SizedBox(height: 14),

          // Action buttons
          Row(
            children: [
              Expanded(
                child: FilledButton(
                  onPressed: _hasMissingRequired || isRunning
                      ? null
                      : () {
                          context.read<ReportRunnerCubit>().run(
                                widget.report.key,
                                filters: _filters.isNotEmpty ? _filters : null,
                              );
                          // Scroll to result after a tick.
                          Future.delayed(
                              const Duration(milliseconds: 300), () {
                            Scrollable.ensureVisible(
                              context,
                              duration: const Duration(milliseconds: 300),
                            );
                          });
                        },
                  child: isRunning
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Run'),
                ),
              ),
              const SizedBox(width: 10),
              OutlinedButton(
                onPressed: _hasMissingRequired
                    ? null
                    : () => context.read<ReportRunnerCubit>().exportCsv(
                          widget.report.key,
                          filters: _filters.isNotEmpty ? _filters : null,
                        ),
                child: const Text('Export'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFilter(ReportFilterSpec spec, Color muted) {
    switch (spec.type) {
      case 'section':
        return DropdownButtonFormField<String>(
          initialValue: _filters[spec.key]?.isNotEmpty == true ? _filters[spec.key] : null,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: spec.label + (spec.required ? ' *' : ''),
            isDense: true,
            hintText:
                spec.required ? 'Choose one' : 'All sections',
          ),
          items: [
            DropdownMenuItem(
              value: '',
              child: Text(
                spec.required ? 'Choose\u2026' : 'All sections',
                style: TextStyle(color: muted),
              ),
            ),
            for (final s in widget.sections)
              DropdownMenuItem(value: s.id, child: Text(s.label)),
          ],
          onChanged: (v) => setState(() => _filters[spec.key] = v ?? ''),
        );

      case 'date':
        return InkWell(
          onTap: () async {
            final now = DateTime.now();
            final picked = await showDatePicker(
              context: context,
              initialDate: _filters[spec.key] != null
                  ? DateTime.tryParse(_filters[spec.key]!) ?? now
                  : now,
              firstDate: DateTime(2020),
              lastDate: DateTime(now.year + 1),
            );
            if (picked != null) {
              setState(() {
                _filters[spec.key] =
                    '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
              });
            }
          },
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: spec.label,
              isDense: true,
              suffixIcon: const Icon(Icons.calendar_today, size: 18),
            ),
            child: Text(
              _filters[spec.key] ?? '',
              style: TextStyle(
                color: _filters[spec.key] != null ? null : muted,
              ),
            ),
          ),
        );

      case 'boolean':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(spec.label, style: const TextStyle(fontSize: 14)),
          subtitle: spec.hint != null
              ? Text(spec.hint!, style: TextStyle(fontSize: 12, color: muted))
              : null,
          value: _filters[spec.key] == 'true',
          onChanged: (v) => setState(() {
            _filters[spec.key] = v ? 'true' : '';
          }),
        );

      default:
        return const SizedBox.shrink();
    }
  }
}

// ---------------------------------------------------------------- Result Area --

class _ResultArea extends StatelessWidget {
  const _ResultArea({required this.runner});

  final ReportRunnerState runner;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    // Export success
    if (runner.exportPath != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: AppAlert(
          title: 'Exported',
          message: 'Saved to: ${runner.exportPath}',
          warn: true,
        ),
      );
    }

    // Exporting
    if (runner.exporting) {
      return const Padding(
        padding: EdgeInsets.only(top: 16),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    // Error
    if (runner.status == ReportRunnerStatus.failure) {
      return Padding(
        padding: const EdgeInsets.only(top: 16),
        child: AppAlert(
          title: 'Could not run report',
          message: runner.error?.message ?? 'Something went wrong.',
        ),
      );
    }

    final result = runner.result;
    if (result == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
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
                    result.report.name,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                Text(
                  '${result.rowCount} ${result.rowCount == 1 ? 'row' : 'rows'}',
                  style: TextStyle(fontSize: 13, color: muted),
                ),
              ],
            ),
            if (result.message != null) ...[
              const SizedBox(height: 10),
              Text(
                result.message!,
                style: TextStyle(fontSize: 13.5, color: muted),
              ),
            ],
            if (result.rows.isNotEmpty) ...[
              const SizedBox(height: 12),
              if (result.rowCount > 50)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    'Showing the first 50. Export for all of them.',
                    style: TextStyle(fontSize: 12.5, color: AppColors.warn),
                  ),
                ),
              _ResultTable(rows: result.rows),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- Result Table --

class _ResultTable extends StatelessWidget {
  const _ResultTable({required this.rows});

  final List<Map<String, dynamic>> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();

    final keys = rows.first.keys.toList();
    final limited = rows.take(50).toList();

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          minWidth: MediaQuery.of(context).size.width - 76,
        ),
        child: DataTable(
          headingRowHeight: 40,
          dataRowMinHeight: 44,
          columnSpacing: 16,
          columns: [
            for (final key in keys)
              DataColumn(
                label: Text(
                  _humanLabel(key),
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
          ],
          rows: [
            for (final row in limited)
              DataRow(
                cells: [
                  for (final key in keys)
                    DataCell(
                      Text(
                        _formatCell(row[key]),
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: key == 'name' ? FontWeight.w600 : null,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  String _humanLabel(String key) {
    // Convert camelCase to Title Case.
    final spaced = key.replaceAllMapped(
      RegExp(r'([A-Z])'),
      (m) => ' ${m.group(1)}',
    );
    return spaced[0].toUpperCase() + spaced.substring(1);
  }

  String _formatCell(dynamic value) {
    if (value == null) return '';
    if (value is bool) return value ? 'Yes' : '';
    if (value is double) {
      return value == value.roundToDouble()
          ? value.toInt().toString()
          : value.toStringAsFixed(1);
    }
    final s = value.toString();
    if (s.isEmpty) return '';
    // Try to detect dates.
    if (s.length >= 10 && s.contains('-') && s.substring(0, 4).contains(RegExp(r'\d{4}'))) {
      final d = DateTime.tryParse(s);
      if (d != null) {
        return _formatDate(d);
      }
    }
    // Try to detect date-time.
    if (s.contains('T') && s.contains('-')) {
      final d = DateTime.tryParse(s);
      if (d != null) {
        return _formatDateTime(d);
      }
    }
    return s;
  }

  String _formatDate(DateTime d) => Formats.shortDate(d);

  String _formatDateTime(DateTime d) => Formats.shortDateTime(d);
}
