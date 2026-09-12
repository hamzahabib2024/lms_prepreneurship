import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../data/at_risk_repository.dart';

/// STUDENTS AT RISK ON ATTENDANCE — FR-ATT-020/022.
///
/// The point of an early-warning signal is that somebody acts on it, so this
/// sits where a teacher already goes rather than on a page they would have to
/// remember to visit.
///
/// Nothing to show is the good case, and an empty panel on every screen is
/// noise: it appears only when there is something to act on.
class AtRiskPanel extends StatefulWidget {
  const AtRiskPanel({
    super.key,
    required this.api,
    required this.sectionSubjectId,
  });

  final ApiClient api;
  final String sectionSubjectId;

  @override
  State<AtRiskPanel> createState() => _AtRiskPanelState();
}

class _AtRiskPanelState extends State<AtRiskPanel> {
  late final AtRiskCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = AtRiskCubit(widget.api)..load(widget.sectionSubjectId);
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: BlocBuilder<AtRiskCubit, AtRiskState>(
        builder: (context, state) {
          // A teacher who cannot read this panel is not blocked from marking
          // — the register is why they are here — so a refusal is silent.
          if (state.status != AtRiskStatus.loaded) {
            return const SizedBox.shrink();
          }
          if (state.students.isEmpty) return const SizedBox.shrink();
          return _AtRiskBody(
            state: state,
            sectionSubjectId: widget.sectionSubjectId,
          );
        },
      ),
    );
  }
}

class _AtRiskBody extends StatelessWidget {
  const _AtRiskBody({required this.state, required this.sectionSubjectId});

  final AtRiskState state;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final warnFg = dark ? AppColorsDark.warn : AppColors.warn;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    final counts = <String>[
      if (state.critical > 0) '${state.critical} critical',
      if (state.warning > 0) '${state.warning} below the requirement',
      if (state.unacknowledged > 0) '${state.unacknowledged} not yet actioned',
    ];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: warnFg.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.warning_amber_rounded, size: 18, color: warnFg),
                    const SizedBox(width: 8),
                    Text(
                      'Attendance — students at risk',
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: warnFg,
                      ),
                    ),
                  ],
                ),
                if (counts.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    counts.join(' · '),
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ],
                if (state.error != null) ...[
                  const SizedBox(height: 8),
                  AppAlert(
                    title: 'That could not be recorded',
                    message: state.error!.message,
                    reference: state.error!.reference,
                  ),
                ],
              ],
            ),
          ),
          const Divider(height: 1),
          for (final student in state.ordered)
            _AtRiskTile(
              student: student,
              sectionSubjectId: sectionSubjectId,
              busy: state.busyWarningId == student.warningId,
            ),
        ],
      ),
    );
  }
}

class _AtRiskTile extends StatelessWidget {
  const _AtRiskTile({
    required this.student,
    required this.sectionSubjectId,
    required this.busy,
  });

  final AtRiskStudent student;
  final String sectionSubjectId;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = student.isCritical
        ? (dark ? AppColorsDark.error : AppColors.error)
        : (dark ? AppColorsDark.warn : AppColors.warn);
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    final days = student.daysSinceRaised;
    final flagged = days == 0 ? 'today' : '$days day${days == 1 ? '' : 's'} ago';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: (dark ? AppColorsDark.line : AppColors.line)
                .withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  student.rollNo == null
                      ? student.name
                      : '${student.rollNo}. ${student.name}',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                // The severity is a WORD, never a colour alone (NFR-ACC-003).
                Text(
                  student.isCritical ? 'Critical' : 'Below requirement',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: fg,
                  ),
                ),
                Text(
                  '${student.percentage.toStringAsFixed(0)}% against '
                  '${student.thresholdApplied.toStringAsFixed(0)}% required · '
                  'flagged $flagged',
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          if (busy)
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else if (student.isActioned)
            // Deliberately not "resolved". The student is still below the
            // threshold; what happened is that somebody spoke to them.
            const Pill(text: 'Actioned', kind: PillKind.ok)
          else
            OutlinedButton(
              onPressed: () => _recordAction(context),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                textStyle: const TextStyle(fontSize: 12),
              ),
              child: const Text('Record action'),
            ),
        ],
      ),
    );
  }

  Future<void> _recordAction(BuildContext context) async {
    final cubit = context.read<AtRiskCubit>();
    final note = TextEditingController();

    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('What did you do about ${student.name}?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: note,
              autofocus: true,
              minLines: 2,
              maxLines: 4,
              decoration: const InputDecoration(
                hintText: 'Spoke to her after class; she has been unwell.',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'This records that somebody has acted. It does not clear the '
              'warning — that happens when their attendance recovers.',
              style: TextStyle(fontSize: 12.5),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          // The note is optional: a teacher who spoke to a student in the
          // corridor should not have to write an essay before the System will
          // believe them.
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Record'),
          ),
        ],
      ),
    );

    final text = note.text;
    note.dispose();
    if (go != true) return;

    await cubit.acknowledge(
      sectionSubjectId: sectionSubjectId,
      warningId: student.warningId,
      note: text,
    );
  }
}
