import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../data/models/course_lectures.dart';

/// A card showing a lecture's title, duration, availability, and watch
/// progress bar. Used in the course detail lecture list.
class LectureCard extends StatelessWidget {
  const LectureCard({
    super.key,
    required this.lecture,
    required this.index,
    this.onTap,
  });

  final CourseLecture lecture;
  final int index;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final watch = lecture.watch;
    final percent = watch?.watchedPercent ?? 0;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                // Index / play icon.
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: lecture.isAvailable
                        ? (dark
                            ? AppColorsDark.brand050
                            : AppColors.brand050)
                        : (dark
                            ? AppColorsDark.surface2
                            : AppColors.surface2),
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Center(
                    child: lecture.isAvailable
                        ? Icon(
                            Icons.play_arrow_rounded,
                            size: 20,
                            color: dark
                                ? AppColorsDark.brand600
                                : AppColors.brand600,
                          )
                        : Text(
                            '$index',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: muted,
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: 12),

                // Title + metadata.
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        lecture.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          if (lecture.durationSeconds != null) ...[
                            Icon(Icons.schedule, size: 12, color: muted),
                            const SizedBox(width: 3),
                            Text(
                              _formatDuration(lecture.durationSeconds!),
                              style:
                                  TextStyle(fontSize: 11.5, color: muted),
                            ),
                            const SizedBox(width: 8),
                          ],
                          if (!lecture.isAvailable)
                            Text(
                              'Not available',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: AppColors.error,
                              ),
                            ),
                        ],
                      ),
                      // Progress bar.
                      if (watch != null && watch.watchedPercent > 0) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(
                              child: ClipRRect(
                                borderRadius: BorderRadius.circular(2),
                                child: LinearProgressIndicator(
                                  value: (percent / 100).clamp(0.0, 1.0),
                                  minHeight: 4,
                                  backgroundColor: Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              '${percent.toStringAsFixed(0)}%',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: watch.isComplete
                                    ? AppColors.ok
                                    : muted,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),

                // Status indicators.
                const SizedBox(width: 8),
                Column(
                  children: [
                    if (watch?.isComplete == true)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.okBg,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.check_circle,
                                size: 10, color: AppColors.ok),
                            SizedBox(width: 3),
                            Text(
                              'Done',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ok,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
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
