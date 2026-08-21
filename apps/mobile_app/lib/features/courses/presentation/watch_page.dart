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

/// The watch page — video player for a single lecture recording.
///
/// The video is the page. On the left (portrait: top) is the player; below
/// it is the lecture title, metadata, and progress. This mirrors the web's
/// WatchPage with variant="inline".
class WatchPage extends StatelessWidget {
  const WatchPage({
    super.key,
    required this.api,
    required this.user,
    required this.sectionSubjectId,
    required this.lecture,
  });

  final ApiClient api;
  final AuthUser user;
  final String sectionSubjectId;
  final CourseLecture lecture;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WatchCubit(
        repository: CoursesRepository(api: api),
        lectureId: lecture.id,
      )..loadTicket(),
      child: _WatchView(lecture: lecture, user: user),
    );
  }
}

class _WatchView extends StatelessWidget {
  const _WatchView({required this.lecture, required this.user});

  final CourseLecture lecture;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          lecture.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
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
                        onPressed: () => context.read<WatchCubit>().loadTicket(),
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
              return _WatchBody(
                ticket: ticket,
                lecture: lecture,
                user: user,
              );
          }
        },
      ),
    );
  }
}

class _WatchBody extends StatelessWidget {
  const _WatchBody({
    required this.ticket,
    required this.lecture,
    required this.user,
  });

  final PlaybackTicket ticket;
  final CourseLecture lecture;
  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Video player
        LecturePlayerWidget(
          ticket: ticket,
          lecture: lecture,
          user: user,
        ),

        // Lecture metadata
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
              // Progress bar
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
                          backgroundColor:
                              Theme.of(context).colorScheme.surfaceContainerHighest,
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
                    color: Theme.of(context)
                        .colorScheme
                        .onSurfaceVariant,
                    height: 1.5,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    if (h > 0) return '${h}h ${m}m';
    if (m > 0) return '${m}m ${s}s';
    return '${s}s';
  }
}

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
