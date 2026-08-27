/// Marking queue page — SRS §13.6, FR-TCH-018.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/formats.dart';
import '../../../../core/theme/app_theme.dart';
import '../cubit/marking_cubit.dart';
import '../data/marking_repository.dart';
import '../data/models/marking_models.dart';
import 'grading_page.dart';
import 'quiz_marking_page.dart';

class MarkingQueuePage extends StatefulWidget {
  const MarkingQueuePage({super.key});

  @override
  State<MarkingQueuePage> createState() => _MarkingQueuePageState();
}

class _MarkingQueuePageState extends State<MarkingQueuePage> {
  late final MarkingQueueCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = MarkingQueueCubit(context.read<MarkingRepository>())
      ..loadSections();
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
          title: const Text('Marking Queue'),
        ),
        body: BlocConsumer<MarkingQueueCubit, MarkingQueueState>(
          listener: (context, state) {
            if (state.status == MarkingQueueStatus.failure && state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == MarkingQueueStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            return Column(
              children: [
                _SectionPicker(
                  sections: state.sections,
                  selected: state.selectedSection,
                  dark: dark,
                  onSelected: (s) => _cubit.selectSection(s),
                ),
                if (state.selectedSection == null)
                  Expanded(
                    child: Center(
                      child: Text(
                        'Select a section to view its queue',
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    ),
                  )
                else
                  Expanded(
                    child: _QueueTabs(
                      assignments: state.assignments,
                      quizzes: state.quizzes,
                      dark: dark,
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

// ── Section Picker ──

class _SectionPicker extends StatelessWidget {
  const _SectionPicker({
    required this.sections,
    required this.selected,
    required this.dark,
    required this.onSelected,
  });

  final List<TeacherSection> sections;
  final TeacherSection? selected;
  final bool dark;
  final ValueChanged<TeacherSection> onSelected;

  @override
  Widget build(BuildContext context) {
    if (sections.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No sections found',
          style: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<TeacherSection>(
          value: selected,
          isExpanded: true,
          hint: Text(
            'Select section',
            style: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
          ),
          items: sections.map((s) {
            return DropdownMenuItem(
              value: s,
              child: Text(
                '${s.subjectCode} - ${s.sectionCode} (${s.enrolled} enrolled)',
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                ),
              ),
            );
          }).toList(),
          onChanged: (s) {
            if (s != null) onSelected(s);
          },
        ),
      ),
    );
  }
}

// ── Queue Tabs ──

class _QueueTabs extends StatelessWidget {
  const _QueueTabs({
    required this.assignments,
    required this.quizzes,
    required this.dark,
  });

  final List<TeacherAssignment> assignments;
  final List<TeacherQuiz> quizzes;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          TabBar(
            labelColor: dark ? AppColorsDark.ink : AppColors.brand600,
            unselectedLabelColor: dark ? AppColorsDark.muted : AppColors.muted,
            indicatorColor: dark ? AppColorsDark.ink : AppColors.brand600,
            tabs: [
              Tab(text: 'Assignments (${assignments.length})'),
              Tab(text: 'Quizzes (${quizzes.length})'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: [
                _AssignmentList(assignments: assignments, dark: dark),
                _QuizList(quizzes: quizzes, dark: dark),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Assignment List ──

class _AssignmentList extends StatelessWidget {
  const _AssignmentList({required this.assignments, required this.dark});
  final List<TeacherAssignment> assignments;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    if (assignments.isEmpty) {
      return Center(
        child: Text(
          'No assignments in queue',
          style: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: assignments.length,
      itemBuilder: (context, index) {
        final a = assignments[index];
        final progress =
            a.submittedCount > 0 ? a.gradedCount / a.submittedCount : 0.0;

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: dark ? AppColorsDark.surface : null,
          child: ListTile(
            title: Text(
              a.title,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Text(
                  'Due: ${_formatDate(a.dueAt)}',
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _QueueBadge(
                      label: 'Submitted: ${a.submittedCount}',
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                      dark: dark,
                    ),
                    const SizedBox(width: 8),
                    _QueueBadge(
                      label: 'Graded: ${a.gradedCount}',
                      color: AppColors.ok,
                      dark: dark,
                    ),
                    if (a.ungradedCount > 0) ...[
                      const SizedBox(width: 8),
                      _QueueBadge(
                        label: 'Pending: ${a.ungradedCount}',
                        color: AppColors.warn,
                        dark: dark,
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: progress.toDouble(),
                  backgroundColor:
                      dark ? AppColorsDark.surface2 : AppColors.surface2,
                  color: AppColors.ok,
                  minHeight: 4,
                  borderRadius: BorderRadius.circular(2),
                ),
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (a.ungradedCount > 0)
                  IconButton(
                    icon: Icon(
                      Icons.grading,
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => RepositoryProvider.value(
                            value: context.read<MarkingRepository>(),
                            child: GradingPage(
                              assignmentId: a.id,
                              title: a.title,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ── Quiz List ──

class _QuizList extends StatelessWidget {
  const _QuizList({required this.quizzes, required this.dark});
  final List<TeacherQuiz> quizzes;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    if (quizzes.isEmpty) {
      return Center(
        child: Text(
          'No quizzes in queue',
          style: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: quizzes.length,
      itemBuilder: (context, index) {
        final q = quizzes[index];

        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          color: dark ? AppColorsDark.surface : null,
          child: ListTile(
            title: Text(
              q.title,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Text(
                  'Closes: ${_formatDate(q.closesAt)}',
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _QueueBadge(
                      label: 'Attempts: ${q.attemptCount}',
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                      dark: dark,
                    ),
                    const SizedBox(width: 8),
                    if (q.awaitingMarking > 0)
                      _QueueBadge(
                        label: 'Marking: ${q.awaitingMarking}',
                        color: AppColors.warn,
                        dark: dark,
                      ),
                    if (q.unreleased > 0) ...[
                      const SizedBox(width: 8),
                      _QueueBadge(
                        label: 'Unreleased: ${q.unreleased}',
                        color: AppColors.warn,
                        dark: dark,
                      ),
                    ],
                  ],
                ),
              ],
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (q.awaitingMarking > 0)
                  IconButton(
                    icon: Icon(
                      Icons.quiz,
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => RepositoryProvider.value(
                            value: context.read<MarkingRepository>(),
                            child: QuizMarkingPage(
                              quizId: q.id,
                              title: q.title,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

// ── Queue Badge ──

class _QueueBadge extends StatelessWidget {
  const _QueueBadge({
    required this.label,
    required this.color,
    required this.dark,
  });

  final String label;
  final Color color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: dark ? 0.2 : 0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

String _formatDate(String dateStr) {
  try {
    final dt = DateTime.parse(dateStr);
    return '${Formats.shortDate(dt)} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
  } catch (_) {
    return dateStr;
  }
}
