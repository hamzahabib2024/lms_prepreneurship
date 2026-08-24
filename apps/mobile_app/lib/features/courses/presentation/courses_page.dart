import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/courses_cubit.dart';
import '../data/courses_repository.dart';
import '../data/models/course.dart';
import 'course_detail_page.dart';

/// Every class, in one place — the mobile equivalent of the web's
/// CoursesPage. Shows enrolled courses with published/draft lecture counts,
/// search, and a filter for waiting (drafts exist) or unconnected courses.
class CoursesPage extends StatelessWidget {
  const CoursesPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => CoursesCubit(
        repository: CoursesRepository(api: api),
      )..load(),
      child: _CoursesView(user: user),
    );
  }
}

class _CoursesView extends StatelessWidget {
  const _CoursesView({required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Courses'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
              child: BlocBuilder<CoursesCubit, CoursesState>(
                builder: (context, state) {
                  return TextField(
                    onChanged: (v) =>
                        context.read<CoursesCubit>().updateQuery(v),
                    decoration: InputDecoration(
                      hintText: 'Search courses…',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      hintStyle: TextStyle(color: muted, fontSize: 14),
                      filled: true,
                      fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 10),
                    ),
                    style: const TextStyle(fontSize: 14),
                  );
                },
              ),
            ),
            Expanded(
              child: BlocBuilder<CoursesCubit, CoursesState>(
                builder: (context, state) {
                  switch (state.status) {
                    case CoursesStatus.loading:
                      return const SingleChildScrollView(
                        padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
                        child: SkeletonCards(count: 4),
                      );
                    case CoursesStatus.failure:
                      return ListView(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                        children: [
                          AppAlert(
                            title: 'Could not load courses',
                            message:
                                state.error?.message ?? 'Something went wrong.',
                            reference: state.error?.reference,
                          ),
                          const SizedBox(height: 14),
                          FilledButton.icon(
                            onPressed: () =>
                                context.read<CoursesCubit>().load(),
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Try again'),
                          ),
                        ],
                      );
                    case CoursesStatus.loaded:
                      final courses = state.filtered;
                      if (courses.isEmpty) {
                        return Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                              state.query.isEmpty
                                  ? 'No courses to show yet.'
                                  : 'No courses match "${state.query}".',
                              style: TextStyle(color: muted, fontSize: 14),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        );
                      }
                      return RefreshIndicator(
                        onRefresh: () =>
                            context.read<CoursesCubit>().load(),
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                          itemCount: courses.length,
                          itemBuilder: (context, i) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _CourseCard(
                              course: courses[i],
                              user: user,
                            ),
                          ),
                        ),
                      );
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CourseCard extends StatelessWidget {
  const _CourseCard({required this.course, required this.user});

  final Course course;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => CourseDetailPage(
                  api: context.read<CoursesCubit>().repository.api,
                  user: user,
                  sectionSubjectId: course.section.id,
                  subjectName: course.subject.name,
                  sectionName: course.section.name,
                ),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: dark
                            ? AppColorsDark.brand050
                            : AppColors.brand050,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Icon(
                        Icons.menu_book_outlined,
                        size: 20,
                        color: dark
                            ? AppColorsDark.brand600
                            : AppColors.brand600,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            course.subject.name,
                            style: const TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${course.section.code} — ${course.section.name}',
                            style:
                                TextStyle(fontSize: 12.5, color: muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    if (course.teachers.isNotEmpty)
                      Expanded(
                        child: Text(
                          course.teachers.join(', '),
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 12, color: muted),
                        ),
                      ),
                    const SizedBox(width: 8),
                    _CountPill(
                      label: '${course.publishedCount} live',
                      ok: course.publishedCount > 0,
                    ),
                    if (course.draftCount > 0) ...[
                      const SizedBox(width: 6),
                      _CountPill(
                        label: '${course.draftCount} draft',
                        ok: false,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CountPill extends StatelessWidget {
  const _CountPill({required this.label, required this.ok});

  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: ok ? AppColors.okBg : AppColors.warnBg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: ok ? AppColors.ok : AppColors.warn,
        ),
      ),
    );
  }
}
