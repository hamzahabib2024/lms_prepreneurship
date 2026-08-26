import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import '../cubit/watch_cubit.dart';
import '../data/courses_repository.dart';
import '../data/models/course_lectures.dart';
import '../data/models/playback_ticket.dart';
import 'widgets/lecture_player_widget.dart';

/// The watch page — video player for a single lecture recording with a
/// sidebar playlist for navigating between lectures.
class WatchPage extends StatelessWidget {
  const WatchPage({
    super.key,
    required this.api,
    required this.user,
    required this.sectionSubjectId,
    required this.lecture,
    this.allLectures = const [],
    this.currentIndex = 0,
  });

  final ApiClient api;
  final AuthUser user;
  final String sectionSubjectId;
  final CourseLecture lecture;
  final List<CourseLecture> allLectures;
  final int currentIndex;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WatchCubit(
        repository: CoursesRepository(api: api),
        lectureId: lecture.id,
      )..loadTicket(),
      child: _WatchView(
        lecture: lecture,
        user: user,
        allLectures: allLectures,
        currentIndex: currentIndex,
        api: api,
        sectionSubjectId: sectionSubjectId,
      ),
    );
  }
}

class _WatchView extends StatelessWidget {
  const _WatchView({
    required this.lecture,
    required this.user,
    required this.allLectures,
    required this.currentIndex,
    required this.api,
    required this.sectionSubjectId,
  });

  final CourseLecture lecture;
  final AuthUser user;
  final List<CourseLecture> allLectures;
  final int currentIndex;
  final ApiClient api;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    final isLandscape =
        MediaQuery.of(context).orientation == Orientation.landscape;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          lecture.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          if (allLectures.length > 1)
            IconButton(
              icon: const Icon(Icons.queue_music, size: 22),
              tooltip: 'Playlist',
              onPressed: () => _showPlaylist(context),
            ),
        ],
      ),
      body: BlocBuilder<WatchCubit, WatchState>(
        builder: (context, state) {
          switch (state.status) {
            case WatchStatus.loading:
              return const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text('Preparing video…'),
                  ],
                ),
              );
            case WatchStatus.failure:
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline,
                          size: 48, color: Color(0xFFB91C1C)),
                      const SizedBox(height: 12),
                      Text(
                        state.error?.message ??
                            'Could not start this lecture.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 14),
                      ),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        onPressed: () =>
                            context.read<WatchCubit>().loadTicket(),
                        icon: const Icon(Icons.refresh, size: 18),
                        label: const Text('Try again'),
                      ),
                    ],
                  ),
                ),
              );
            case WatchStatus.loaded:
              final ticket = state.ticket;
              if (ticket == null) return const SizedBox.shrink();
              if (isLandscape) {
                return _LandscapeBody(
                  ticket: ticket,
                  lecture: lecture,
                  user: user,
                  allLectures: allLectures,
                  currentIndex: currentIndex,
                  api: api,
                  sectionSubjectId: sectionSubjectId,
                );
              }
              return _PortraitBody(
                ticket: ticket,
                lecture: lecture,
                user: user,
                allLectures: allLectures,
                currentIndex: currentIndex,
                api: api,
                sectionSubjectId: sectionSubjectId,
              );
          }
        },
      ),
    );
  }

  void _showPlaylist(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => _PlaylistSheet(
        lectures: allLectures,
        currentIndex: currentIndex,
        api: api,
        user: user,
        sectionSubjectId: sectionSubjectId,
      ),
    );
  }
}

// ── Portrait layout ──

class _PortraitBody extends StatelessWidget {
  const _PortraitBody({
    required this.ticket,
    required this.lecture,
    required this.user,
    required this.allLectures,
    required this.currentIndex,
    required this.api,
    required this.sectionSubjectId,
  });

  final PlaybackTicket ticket;
  final CourseLecture lecture;
  final AuthUser user;
  final List<CourseLecture> allLectures;
  final int currentIndex;
  final ApiClient api;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LecturePlayerWidget(
          ticket: ticket,
          lecture: lecture,
          user: user,
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                lecture.title,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  if (lecture.recordedOn.isNotEmpty)
                    _MetaChip(label: lecture.recordedOn),
                  if (lecture.durationSeconds != null)
                    _MetaChip(
                      label: _formatDuration(lecture.durationSeconds!),
                    ),
                  if (lecture.watch?.isComplete == true)
                    _MetaChip(
                      label: 'Watched',
                      color: AppColors.ok,
                      bgColor: AppColors.okBg,
                    ),
                ],
              ),
              const SizedBox(height: 12),
              if (lecture.watch != null) ...[
                Row(
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: (lecture.watch!.watchedPercent / 100)
                              .clamp(0.0, 1.0),
                          minHeight: 6,
                          backgroundColor: Theme.of(context)
                              .colorScheme
                              .surfaceContainerHighest,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${lecture.watch!.watchedPercent.toStringAsFixed(0)}%',
                      style: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
              ],
              if (lecture.description != null &&
                  lecture.description!.isNotEmpty)
                Text(
                  lecture.description!,
                  style: TextStyle(
                    fontSize: 13.5,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    height: 1.5,
                  ),
                ),
              // Inline playlist for portrait
              if (allLectures.length > 1) ...[
                const SizedBox(height: 20),
                Text(
                  'Up next',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                for (int i = 0; i < allLectures.length; i++)
                  _PlaylistTile(
                    lecture: allLectures[i],
                    index: i,
                    isCurrent: i == currentIndex,
                    onTap: () => _navigateToLecture(context, i),
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  void _navigateToLecture(BuildContext context, int index) {
    final target = allLectures[index];
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => WatchPage(
          api: api,
          user: user,
          sectionSubjectId: sectionSubjectId,
          lecture: target,
          allLectures: allLectures,
          currentIndex: index,
        ),
      ),
    );
  }
}

// ── Landscape layout ──

class _LandscapeBody extends StatelessWidget {
  const _LandscapeBody({
    required this.ticket,
    required this.lecture,
    required this.user,
    required this.allLectures,
    required this.currentIndex,
    required this.api,
    required this.sectionSubjectId,
  });

  final PlaybackTicket ticket;
  final CourseLecture lecture;
  final AuthUser user;
  final List<CourseLecture> allLectures;
  final int currentIndex;
  final ApiClient api;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Video player
        Expanded(
          flex: 3,
          child: LecturePlayerWidget(
            ticket: ticket,
            lecture: lecture,
            user: user,
          ),
        ),
        // Sidebar playlist
        if (allLectures.length > 1)
          Container(
            width: 280,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border(
                left: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Playlist (${allLectures.length})',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    itemCount: allLectures.length,
                    itemBuilder: (context, i) => _PlaylistTile(
                      lecture: allLectures[i],
                      index: i,
                      isCurrent: i == currentIndex,
                      onTap: () => _navigateToLecture(context, i),
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  void _navigateToLecture(BuildContext context, int index) {
    final target = allLectures[index];
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => WatchPage(
          api: api,
          user: user,
          sectionSubjectId: sectionSubjectId,
          lecture: target,
          allLectures: allLectures,
          currentIndex: index,
        ),
      ),
    );
  }
}

// ── Playlist bottom sheet ──

class _PlaylistSheet extends StatelessWidget {
  const _PlaylistSheet({
    required this.lectures,
    required this.currentIndex,
    required this.api,
    required this.user,
    required this.sectionSubjectId,
  });

  final List<CourseLecture> lectures;
  final int currentIndex;
  final ApiClient api;
  final AuthUser user;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.6,
      ),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius:
            const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 12),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.lineStrong : AppColors.lineStrong,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Text(
              'Playlist (${lectures.length})',
              style: TextStyle(
                fontFamily: AppFonts.display,
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: dark ? AppColorsDark.ink : AppColors.ink,
              ),
            ),
          ),
          const Divider(height: 1),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: lectures.length,
              itemBuilder: (context, i) => _PlaylistTile(
                lecture: lectures[i],
                index: i,
                isCurrent: i == currentIndex,
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) => WatchPage(
                        api: api,
                        user: user,
                        sectionSubjectId: sectionSubjectId,
                        lecture: lectures[i],
                        allLectures: lectures,
                        currentIndex: i,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Playlist tile ──

class _PlaylistTile extends StatelessWidget {
  const _PlaylistTile({
    required this.lecture,
    required this.index,
    required this.isCurrent,
    required this.onTap,
  });

  final CourseLecture lecture;
  final int index;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brandFg = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      decoration: BoxDecoration(
        color: isCurrent
            ? (dark ? AppColorsDark.brand050 : AppColors.brand050)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: ListTile(
        dense: true,
        leading: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: isCurrent
                ? brandFg
                : (dark ? AppColorsDark.surface2 : AppColors.surface2),
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: isCurrent
              ? const Icon(Icons.play_arrow, size: 16, color: Colors.white)
              : Text(
                  '${index + 1}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: muted,
                  ),
                ),
        ),
        title: Text(
          lecture.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 13,
            fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w500,
            color: isCurrent
                ? brandFg
                : (dark ? AppColorsDark.ink : AppColors.ink),
          ),
        ),
        subtitle: lecture.watch?.isComplete == true
            ? Text(
                'Watched',
                style: TextStyle(fontSize: 11, color: AppColors.ok),
              )
            : null,
        onTap: onTap,
      ),
    );
  }
}

// ── Meta chip ──

class _MetaChip extends StatelessWidget {
  const _MetaChip({
    required this.label,
    this.color,
    this.bgColor,
  });

  final String label;
  final Color? color;
  final Color? bgColor;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor ??
            (dark ? AppColorsDark.brand050 : AppColors.brand050),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: color ??
              (dark ? AppColorsDark.brand600 : AppColors.brand600),
        ),
      ),
    );
  }
}

String _formatDuration(int seconds) {
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  final s = seconds % 60;
  if (h > 0) return '${h}h ${m}m';
  if (m > 0) return '${m}m ${s}s';
  return '${s}s';
}
