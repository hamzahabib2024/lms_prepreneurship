import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../data/at_risk_repository.dart';

/// Displays at-risk students (attendance warnings) for a section-subject.
/// Embed this widget in marking or attendance pages.
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
          if (state.status == AtRiskStatus.loading) {
            return const SizedBox.shrink();
          }
          if (state.students.isEmpty) {
            return const SizedBox.shrink();
          }
          return _AtRiskBody(
            students: state.students,
            sectionSubjectId: widget.sectionSubjectId,
          );
        },
      ),
    );
  }
}

class _AtRiskBody extends StatelessWidget {
  const _AtRiskBody({
    required this.students,
    required this.sectionSubjectId,
  });

  final List<AtRiskStudent> students;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final warnFg = dark ? AppColorsDark.warn : AppColors.warn;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: warnFg.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Row(
              children: [
                Icon(Icons.warning_amber_rounded, size: 18, color: warnFg),
                const SizedBox(width: 8),
                Text(
                  'At-Risk Students (${students.length})',
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: warnFg,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          for (final student in students)
            _AtRiskTile(
              student: student,
              sectionSubjectId: sectionSubjectId,
              isCritical: student.severity == 'CRITICAL',
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
    required this.isCritical,
  });

  final AtRiskStudent student;
  final String sectionSubjectId;
  final bool isCritical;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = isCritical
        ? (dark ? AppColorsDark.error : AppColors.error)
        : (dark ? AppColorsDark.warn : AppColors.warn);
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: (dark ? AppColorsDark.line : AppColors.line).withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: fg.withValues(alpha: 0.12),
            child: Text(
              student.studentName.isNotEmpty
                  ? student.studentName[0].toUpperCase()
                  : '?',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: fg,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  student.studentName,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${student.attendancePercent.toStringAsFixed(0)}% attendance (threshold: ${student.threshold.toStringAsFixed(0)}%)',
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: fg.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              student.severity,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
                color: fg,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
