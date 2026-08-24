import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../data/models/lesson_resource.dart';

/// A row showing a downloadable lesson resource — file icon, title,
/// size, and a download button.
class LessonResourceTile extends StatelessWidget {
  const LessonResourceTile({
    super.key,
    required this.resource,
    required this.onDownload,
  });

  final LessonResource resource;
  final Future<void> Function(String filename) onDownload;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          Icon(
            _iconForType(resource.contentType),
            size: 20,
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  resource.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${resource.originalFilename} · ${resource.sizeLabel}',
                  style: TextStyle(fontSize: 11.5, color: muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            onPressed: () async {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Downloading…'),
                  duration: Duration(seconds: 1),
                ),
              );
              try {
                await onDownload(resource.originalFilename);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content:
                          Text('Downloaded ${resource.originalFilename}'),
                      backgroundColor: AppColors.ok,
                    ),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Download failed: $e'),
                      backgroundColor: AppColors.error,
                    ),
                  );
                }
              }
            },
            icon: const Icon(Icons.download_rounded, size: 20),
            visualDensity: VisualDensity.compact,
            tooltip: 'Download',
          ),
        ],
      ),
    );
  }

  IconData _iconForType(String contentType) {
    if (contentType.contains('pdf')) return Icons.picture_as_pdf;
    if (contentType.contains('word') || contentType.contains('document')) {
      return Icons.description;
    }
    if (contentType.contains('presentation') ||
        contentType.contains('powerpoint')) {
      return Icons.slideshow;
    }
    if (contentType.contains('image')) return Icons.image;
    if (contentType.contains('sheet') || contentType.contains('excel')) {
      return Icons.table_chart;
    }
    return Icons.insert_drive_file;
  }
}
