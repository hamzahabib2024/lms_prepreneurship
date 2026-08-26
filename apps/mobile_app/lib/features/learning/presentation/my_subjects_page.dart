import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../cubit/my_subjects_cubit.dart';
import '../data/learning_repository.dart';
import '../data/models/learning_models.dart';
import 'subject_detail_page.dart';

/// My Subjects — SRS §13.5, FR-PRG-007.
///
/// The student's enrolled subjects with progress, outstanding work, and
/// completion status. Corresponds to the web's MySubjectsPage.
class MySubjectsPage extends StatelessWidget {
  const MySubjectsPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => MySubjectsCubit(
        repository: LearningRepository(api: api),
      )..load(),
      child: _MySubjectsView(api: api),
    );
  }
}

class _MySubjectsView extends StatelessWidget {
  const _MySubjectsView({required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My subjects'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<MySubjectsCubit, MySubjectsState>(
        builder: (context, state) {
          if (state.status == MySubjectsStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state.status == MySubjectsStatus.failure) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error_outline,
                        size: 48, color: AppColors.error),
                    const SizedBox(height: 12),
                    Text(
                      'Could not load your subjects',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      state.error?.message ?? 'Unknown error',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () =>
                          context.read<MySubjectsCubit>().load(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          final progress = state.progress;
          if (progress == null) return const SizedBox.shrink();

          if (progress.subjects.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.book_outlined,
                        size: 48,
                        color: dark ? AppColorsDark.muted : AppColors.muted),
                    const SizedBox(height: 12),
                    Text(
                      'Nothing here yet',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'You are not enrolled in any subjects yet. They appear '
                      'here as soon as your enrolment is confirmed.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => context.read<MySubjectsCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: [
                // KPI summary
                _KpiRow(progress: progress),
                const SizedBox(height: 16),
                // Subject cards
                for (final subject in progress.subjects)
                  _SubjectCard(
                    subject: subject,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => SubjectDetailPage(
                          api: api,
                          sectionSubjectId: subject.sectionSubjectId,
                          subjectName: subject.subjectName,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _KpiRow extends StatelessWidget {
  const _KpiRow({required this.progress});

  final MyProgress progress;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final stillToFinish = progress.subjectCount - progress.completedCount;

    return Row(
      children: [
        _KpiTile(
          label: 'Overall',
          value: '${progress.overallPercent}%',
          note: 'across every subject',
          dark: dark,
        ),
        const SizedBox(width: 8),
        _KpiTile(
          label: 'Complete',
          value: '${progress.completedCount}',
          note: 'of ${progress.subjectCount}',
          dark: dark,
        ),
        const SizedBox(width: 8),
        _KpiTile(
          label: 'Still to finish',
          value: '$stillToFinish',
          note: stillToFinish == 0 ? 'nothing outstanding' : 'shown below',
          dark: dark,
          isWarn: stillToFinish > 0,
        ),
      ],
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({
    required this.label,
    required this.value,
    required this.note,
    required this.dark,
    this.isWarn = false,
  });

  final String label;
  final String value;
  final String note;
  final bool dark;
  final bool isWarn;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(
            color: isWarn
                ? AppColors.warn.withValues(alpha: 0.3)
                : (dark ? AppColorsDark.line : AppColors.line),
          ),
          boxShadow: AppShadow.soft,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: isWarn
                    ? AppColors.warn
                    : (dark ? AppColorsDark.ink : AppColors.ink),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              note,
              style: TextStyle(
                fontSize: 11,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({required this.subject, required this.onTap});

  final SubjectProgress subject;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
          boxShadow: AppShadow.soft,
        ),
        clipBehavior: Clip.antiAlias,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      // Progress indicator
                      SizedBox(
                        width: 44,
                        height: 44,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            CircularProgressIndicator(
                              value: subject.overallPercent / 100,
                              strokeWidth: 4,
                              backgroundColor: (dark
                                      ? AppColorsDark.line
                                      : AppColors.line)
                                  .withValues(alpha: 0.5),
                              valueColor: AlwaysStoppedAnimation<Color>(
                                subject.completionMet
                                    ? AppColors.ok
                                    : (dark
                                        ? AppColorsDark.brand600
                                        : AppColors.brand600),
                              ),
                            ),
                            Text(
                              '${subject.overallPercent}%',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: dark ? AppColorsDark.ink : AppColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              subject.subjectName,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              subject.subjectCode,
                              style: TextStyle(
                                fontSize: 12,
                                color:
                                    dark ? AppColorsDark.muted : AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      if (subject.completionMet)
                        _Pill(
                          text: 'Requirements met',
                          color: AppColors.ok,
                          dark: dark,
                        )
                      else
                        _Pill(
                          text: '${subject.outstanding.length} outstanding',
                          color: AppColors.warn,
                          dark: dark,
                        ),
                      const SizedBox(width: 8),
                      _Pill(
                        text: subject.attendancePercent == null
                            ? 'Attendance not recorded'
                            : 'Attendance ${subject.attendancePercent}%',
                        dark: dark,
                      ),
                    ],
                  ),
                  if (!subject.completionMet &&
                      subject.outstanding.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    for (final item
                        in subject.outstanding.take(3))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Text(
                          item,
                          style: TextStyle(
                            fontSize: 12,
                            color:
                                dark ? AppColorsDark.muted : AppColors.muted,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    if (subject.outstanding.length > 3)
                      Text(
                        'and ${subject.outstanding.length - 3} more',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: dark
                              ? AppColorsDark.brand600
                              : AppColors.brand600,
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, this.color, required this.dark});

  final String text;
  final Color? color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final pillColor = color ?? (dark ? AppColorsDark.muted : AppColors.muted);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: pillColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: pillColor,
        ),
      ),
    );
  }
}
