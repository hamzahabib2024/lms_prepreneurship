import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/course_detail_cubit.dart';
import '../data/courses_repository.dart';
import '../data/models/course_lectures.dart';
import '../presentation/widgets/lecture_card.dart';
import 'watch_page.dart';

/// The content tree for a specific class — modules, lessons, lectures,
/// with per-lecture progress and downloadable resources.
///
/// This is the mobile equivalent of the web's SubjectPage + CoursePage.
class CourseDetailPage extends StatelessWidget {
  const CourseDetailPage({
    super.key,
    required this.api,
    required this.user,
    required this.sectionSubjectId,
    required this.subjectName,
    required this.sectionName,
  });

  final ApiClient api;
  final AuthUser user;
  final String sectionSubjectId;
  final String subjectName;
  final String sectionName;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => CourseDetailCubit(
        repository: CoursesRepository(api: api),
        sectionSubjectId: sectionSubjectId,
      )..load(),
      child: _CourseDetailView(
        subjectName: subjectName,
        sectionName: sectionName,
        user: user,
        sectionSubjectId: sectionSubjectId,
        api: api,
      ),
    );
  }
}

class _CourseDetailView extends StatelessWidget {
  const _CourseDetailView({
    required this.subjectName,
    required this.sectionName,
    required this.user,
    required this.sectionSubjectId,
    required this.api,
  });

  final String subjectName;
  final String sectionName;
  final AuthUser user;
  final String sectionSubjectId;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: Text(subjectName),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(
            color: dark ? AppColorsDark.line : AppColors.line,
            height: 1,
          ),
        ),
      ),
      body: BlocBuilder<CourseDetailCubit, CourseDetailState>(
        builder: (context, state) {
          switch (state.status) {
            case CourseDetailStatus.loading:
              return const SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
                child: SkeletonCards(count: 3),
              );
            case CourseDetailStatus.failure:
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  AppAlert(
                    title: 'Could not load this class',
                    message:
                        state.error?.message ?? 'Something went wrong.',
                    reference: state.error?.reference,
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () =>
                        context.read<CourseDetailCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              );
            case CourseDetailStatus.loaded:
              final data = state.data;
              if (data == null || data.lectures.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.video_library_outlined,
                            size: 48, color: muted),
                        const SizedBox(height: 12),
                        Text(
                          'No recordings available yet.',
                          style: TextStyle(color: muted, fontSize: 14),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          sectionName,
                          style: TextStyle(color: muted, fontSize: 12.5),
                        ),
                      ],
                    ),
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: () =>
                    context.read<CourseDetailCubit>().load(),
                child: _LectureList(
                  data: data,
                  state: state,
                  user: user,
                  sectionSubjectId: sectionSubjectId,
                  api: api,
                ),
              );
          }
        },
      ),
    );
  }
}

class _LectureList extends StatelessWidget {
  const _LectureList({
    required this.data,
    required this.state,
    required this.user,
    required this.sectionSubjectId,
    required this.api,
  });

  final CourseLectures data;
  final CourseDetailState state;
  final AuthUser user;
  final String sectionSubjectId;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final playable = state.playable;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      children: [
        // Section info
        Text(
          '${data.section.code} — ${data.section.name}',
          style: TextStyle(fontSize: 12.5, color: muted),
        ),
        const SizedBox(height: 4),
        Text(
          '${data.lectures.length} recording${data.lectures.length == 1 ? '' : 's'}'
          ' · ${playable.length} available',
          style: TextStyle(fontSize: 12.5, color: muted),
        ),
        const SizedBox(height: 16),

        // Lecture list
        for (int i = 0; i < data.lectures.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: LectureCard(
              lecture: data.lectures[i],
              index: i + 1,
              onTap: data.lectures[i].isAvailable
                  ? () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => WatchPage(
                            api: api,
                            user: user,
                            sectionSubjectId: sectionSubjectId,
                            lecture: data.lectures[i],
                            allLectures: data.lectures,
                            currentIndex: i,
                          ),
                        ),
                      )
                  : null,
            ),
          ),
      ],
    );
  }
}
