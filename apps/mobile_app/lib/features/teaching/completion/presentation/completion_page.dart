/// Completion sign-off page — SRS §13.6, FR-TCH-023.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/completion_cubit.dart';
import '../data/completion_repository.dart';
import '../data/models/completion_models.dart';

class CompletionPage extends StatefulWidget {
  const CompletionPage({super.key, required this.sectionSubjectId});
  final String sectionSubjectId;

  @override
  State<CompletionPage> createState() => _CompletionPageState();
}

class _CompletionPageState extends State<CompletionPage> {
  late final CompletionCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = CompletionCubit(context.read<CompletionRepository>())
      ..load(widget.sectionSubjectId);
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Completion'),
        ),
        body: BlocConsumer<CompletionCubit, CompletionState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == CompletionStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final roster = state.roster;
            if (roster == null) {
              return const Center(child: Text('No roster data'));
            }

            return RefreshIndicator(
              onRefresh: () => _cubit.load(widget.sectionSubjectId),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Header
                  Text(
                    '${roster.sectionSubject.subject} — ${roster.sectionSubject.section}',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Summary
                  _SummaryBar(summary: roster.summary, dark: dark),
                  const SizedBox(height: 16),

                  // Student list
                  Text(
                    'Students',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...roster.students.map((row) => _StudentCompletionTile(
                        row: row,
                        dark: dark,
                        saving: state.saving,
                        onDecisionChanged: (decision, note) {
                          _cubit.saveDecision(
                            studentId: row.studentId,
                            decision: decision,
                            note: note,
                          );
                        },
                      )),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Summary Bar ──

class _SummaryBar extends StatelessWidget {
  const _SummaryBar({required this.summary, required this.dark});
  final CompletionSummary summary;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          _SummaryItem(label: 'Enrolled', value: '${summary.enrolled}', dark: dark),
          _SummaryItem(label: 'Completed', value: '${summary.completed}', color: AppColors.ok, dark: dark),
          _SummaryItem(label: 'Not Completed', value: '${summary.notCompleted}', color: AppColors.error, dark: dark),
          _SummaryItem(label: 'Undecided', value: '${summary.undecided}', color: AppColors.warn, dark: dark),
        ],
      ),
    );
  }
}

// ── Summary Item ──

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({required this.label, required this.value, this.color, required this.dark});
  final String label;
  final String value;
  final Color? color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              color: color ?? (dark ? AppColorsDark.ink : AppColors.ink),
              fontWeight: FontWeight.bold,
              fontSize: 18,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 10,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ── Student Completion Tile ──

class _StudentCompletionTile extends StatelessWidget {
  const _StudentCompletionTile({
    required this.row,
    required this.dark,
    required this.saving,
    required this.onDecisionChanged,
  });

  final CompletionRow row;
  final bool dark;
  final bool saving;
  final void Function(String decision, String? note) onDecisionChanged;

  @override
  Widget build(BuildContext context) {
    final decisionColor = {
      'COMPLETED': AppColors.ok,
      'NOT_COMPLETED': AppColors.error,
      'IN_PROGRESS': AppColors.warn,
    }[row.decision] ?? AppColors.muted;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : null,
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        childrenPadding: const EdgeInsets.all(12),
        leading: CircleAvatar(
          backgroundColor: decisionColor,
          child: Text(
            (row.rollNo ?? '?').toString(),
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ),
        title: Text(
          row.name,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
            fontSize: 14,
          ),
        ),
        subtitle: Row(
          children: [
            Text(
              '${row.computedPercent.toStringAsFixed(0)}%',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
            if (row.attendancePercent != null) ...[
              const SizedBox(width: 8),
              Text(
                'Attend: ${row.attendancePercent!.toStringAsFixed(0)}%',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                ),
              ),
            ],
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: decisionColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                row.decision.replaceAll('_', ' '),
                style: TextStyle(
                  color: decisionColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (row.wasOverride) ...[
              const SizedBox(width: 4),
              Icon(Icons.warning_amber, size: 12, color: AppColors.warn),
            ],
          ],
        ),
        trailing: Icon(
          Icons.expand_more,
          color: dark ? AppColorsDark.muted : AppColors.muted,
        ),
        children: [
          // Outstanding items
          if (row.outstanding.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.warnBg,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Outstanding:',
                    style: TextStyle(
                      color: AppColors.warn,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                  ...row.outstanding.map((item) => Text(
                        '• $item',
                        style: const TextStyle(
                          color: AppColors.warn,
                          fontSize: 12,
                        ),
                      )),
                ],
              ),
            ),
          const SizedBox(height: 12),

          // Decision buttons
          Text(
            'Decision',
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _DecisionButton(
                label: 'In Progress',
                color: AppColors.warn,
                selected: row.decision == 'IN_PROGRESS',
                enabled: !saving,
                onTap: () => onDecisionChanged('IN_PROGRESS', null),
              ),
              const SizedBox(width: 8),
              _DecisionButton(
                label: 'Completed',
                color: AppColors.ok,
                selected: row.decision == 'COMPLETED',
                enabled: !saving,
                onTap: () => _showDecisionDialog(
                  context,
                  row,
                  'COMPLETED',
                  onDecisionChanged,
                ),
              ),
              const SizedBox(width: 8),
              _DecisionButton(
                label: 'Not Completed',
                color: AppColors.error,
                selected: row.decision == 'NOT_COMPLETED',
                enabled: !saving,
                onTap: () => _showDecisionDialog(
                  context,
                  row,
                  'NOT_COMPLETED',
                  onDecisionChanged,
                ),
              ),
            ],
          ),

          if (row.note != null && row.note!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                row.note!,
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _showDecisionDialog(
    BuildContext context,
    CompletionRow row,
    String decision,
    void Function(String decision, String? note) onDecisionChanged,
  ) {
    // Check if this is an override (decision contradicts criteria)
    final isOverride = (decision == 'COMPLETED' && !row.criteriaMet) ||
        (decision == 'NOT_COMPLETED' && row.criteriaMet);

    if (!isOverride) {
      onDecisionChanged(decision, null);
      return;
    }

    final noteController = TextEditingController();
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Override: $decision?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This decision contradicts the computed criteria. '
              'A reason is required (min 10 characters).',
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: noteController,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Enter reason for override...',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (noteController.text.length < 10) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Reason must be at least 10 characters')),
                );
                return;
              }
              Navigator.of(context).pop();
              onDecisionChanged(decision, noteController.text);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}

// ── Decision Button ──

class _DecisionButton extends StatelessWidget {
  const _DecisionButton({
    required this.label,
    required this.color,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final Color color;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: enabled ? onTap : null,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected ? color : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
            border: Border.all(
              color: color,
              width: selected ? 2 : 1,
            ),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: selected ? Colors.white : color,
              fontWeight: FontWeight.w600,
              fontSize: 11,
            ),
          ),
        ),
      ),
    );
  }
}
