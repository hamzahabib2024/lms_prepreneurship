import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../cubit/subject_detail_cubit.dart';
import '../data/learning_repository.dart';

/// Subject Detail — SRS §13.5, §5.6, §5.7.
///
/// Modules, lessons and lectures for a single subject, with progress bar and
/// outstanding work. Corresponds to the web's SubjectPage.
class SubjectDetailPage extends StatelessWidget {
  const SubjectDetailPage({
    super.key,
    required this.api,
    required this.sectionSubjectId,
    required this.subjectName,
  });

  final ApiClient api;
  final String sectionSubjectId;
  final String subjectName;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => SubjectDetailCubit(
        repository: LearningRepository(api: api),
      )..load(sectionSubjectId),
      child: _SubjectDetailView(
        sectionSubjectId: sectionSubjectId,
        subjectName: subjectName,
        api: api,
      ),
    );
  }
}

class _SubjectDetailView extends StatelessWidget {
  const _SubjectDetailView({
    required this.sectionSubjectId,
    required this.subjectName,
    required this.api,
  });

  final String sectionSubjectId;
  final String subjectName;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: Text(subjectName),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<SubjectDetailCubit, SubjectDetailState>(
        builder: (context, state) {
          if (state.status == SubjectDetailStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state.status == SubjectDetailStatus.failure) {
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
                      'Could not load this subject',
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
                      onPressed: () => context
                          .read<SubjectDetailCubit>()
                          .load(sectionSubjectId),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }

          final progress = state.progress;
          if (progress == null) return const SizedBox.shrink();

          final video = progress.components
              .where((c) => c.key == 'video')
              .firstOrNull;

          return RefreshIndicator(
            onRefresh: () => context
                .read<SubjectDetailCubit>()
                .load(sectionSubjectId),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              children: [
                // Progress bar
                _ProgressBar(
                  percent: progress.overallPercent,
                  video: video,
                  attendance: progress.attendance,
                  completionCriteria: progress.completionCriteria,
                  dark: dark,
                ),

                // Modules
                if (state.modules.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius:
                            BorderRadius.circular(AppRadius.md),
                        border: Border.all(
                          color: dark
                              ? AppColorsDark.line
                              : AppColors.line,
                        ),
                        boxShadow: AppShadow.soft,
                      ),
                      child: Text(
                        'No material has been published for this subject yet.',
                        style: TextStyle(
                          fontSize: 13,
                          color:
                              dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    ),
                  ),

                for (final module in state.modules)
                  _ModuleSection(
                    module: module,
                    dark: dark,
                    api: api,
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({
    required this.percent,
    required this.video,
    required this.attendance,
    required this.completionCriteria,
    required this.dark,
  });

  final int percent;
  final dynamic video;
  final dynamic attendance;
  final dynamic completionCriteria;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final videoText = video != null
        ? ' · ${video.completed} of ${video.total} lectures watched'
        : '';
    final attendanceText = attendance?.percentage != null
        ? ' · ${attendance.percentage}% attendance'
        : ' · attendance not recorded yet';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: percent / 100,
              minHeight: 6,
              backgroundColor:
                  (dark ? AppColorsDark.line : AppColors.line)
                      .withValues(alpha: 0.5),
              valueColor: AlwaysStoppedAnimation<Color>(
                dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '$percent% overall$videoText$attendanceText',
            style: TextStyle(
              fontSize: 12,
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
          ),
          if (completionCriteria != null &&
              !completionCriteria.met &&
              completionCriteria.outstanding.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final item in completionCriteria.outstanding)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  item,
                  style: TextStyle(
                    fontSize: 12,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _ModuleSection extends StatelessWidget {
  const _ModuleSection({
    required this.module,
    required this.dark,
    required this.api,
  });

  final dynamic module;
  final bool dark;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
          boxShadow: AppShadow.soft,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              module.title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (module.description != null) ...[
              const SizedBox(height: 4),
              Text(
                module.description,
                style: TextStyle(
                  fontSize: 12,
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
              ),
            ],
            for (final lesson in module.lessons)
              _LessonTile(lesson: lesson, dark: dark, api: api),
          ],
        ),
      ),
    );
  }
}

class _LessonTile extends StatelessWidget {
  const _LessonTile({
    required this.lesson,
    required this.dark,
    required this.api,
  });

  final dynamic lesson;
  final bool dark;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  lesson.title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              if (lesson.estimatedMinutes != null)
                Text(
                  '${lesson.estimatedMinutes} min',
                  style: TextStyle(
                    fontSize: 11,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
            ],
          ),
          if (lesson.lectures.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'No recording for this lesson.',
                style: TextStyle(
                  fontSize: 12,
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
              ),
            ),
          for (final lecture in lesson.lectures)
            _LectureTile(lecture: lecture, dark: dark, api: api),
        ],
      ),
    );
  }
}

class _LectureTile extends StatelessWidget {
  const _LectureTile({
    required this.lecture,
    required this.dark,
    required this.api,
  });

  final dynamic lecture;
  final bool dark;
  final ApiClient api;

  String _formatDuration(int? seconds) {
    if (seconds == null || seconds <= 0) return '';
    final m = (seconds / 60).round();
    if (m < 60) return '$m min';
    return '${m ~/ 60}h ${m % 60}m';
  }

  @override
  Widget build(BuildContext context) {
    final unavailable = lecture.isUnavailable;
    final watched = lecture.isWatched;
    final watchedPct = lecture.watchedPercent;

    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    lecture.title,
                    style: TextStyle(
                      fontSize: 13,
                      color: unavailable
                          ? (dark ? AppColorsDark.muted : AppColors.muted)
                          : null,
                    ),
                  ),
                  if (watched)
                    Text(
                      '✓ watched',
                      style: TextStyle(
                        fontSize: 11,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    )
                  else if (watchedPct > 0)
                    Text(
                      '$watchedPct% watched',
                      style: TextStyle(
                        fontSize: 11,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                ],
              ),
            ),
            Text(
              _formatDuration(lecture.durationSeconds),
              style: TextStyle(
                fontSize: 11,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              unavailable
                  ? 'Unavailable'
                  : watched
                      ? 'Watched'
                      : 'Watch via Courses',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: unavailable
                    ? (dark ? AppColorsDark.muted : AppColors.muted)
                    : (dark ? AppColorsDark.brand600 : AppColors.brand600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
