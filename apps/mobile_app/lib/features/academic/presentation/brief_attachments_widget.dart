import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:file_picker/file_picker.dart';

import '../../../core/theme/app_theme.dart';
import '../cubit/brief_attachments_cubit.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/file_download.dart';

class BriefAttachmentsWidget extends StatelessWidget {
  const BriefAttachmentsWidget({
    super.key,
    required this.cubit,
    required this.canManage,
    this.onChanged,
  });

  final BriefAttachmentsCubit cubit;
  final bool canManage;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: cubit,
      child: _BriefAttachmentsView(
        canManage: canManage,
        onChanged: onChanged,
      ),
    );
  }
}

class _BriefAttachmentsView extends StatelessWidget {
  const _BriefAttachmentsView({
    required this.canManage,
    this.onChanged,
  });

  final bool canManage;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return BlocConsumer<BriefAttachmentsCubit, BriefAttachmentsState>(
      listenWhen: (prev, curr) =>
          prev.files?.length != curr.files?.length ||
          (prev.uploading && !curr.uploading) ||
          (prev.removingId != null && curr.removingId == null),
      listener: (context, state) {
        if (state.error != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.error!.message)),
          );
        }
        onChanged?.call();
      },
      builder: (context, state) {
        final files = state.files;

        if (!canManage && (files == null || files.isEmpty)) {
          return const SizedBox.shrink();
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              canManage ? 'Files that come with this brief' : 'Files from your teacher',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: dark ? AppColorsDark.ink : AppColors.ink,
              ),
            ),
            const SizedBox(height: 8),

            if (files != null && files.isNotEmpty)
              for (final f in files)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Icon(
                        _iconForType(f.contentType),
                        size: 16,
                        color: muted,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              f.filename,
                              style: TextStyle(
                                fontSize: 13,
                                color: dark ? AppColorsDark.ink : AppColors.ink,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              f.formattedSize,
                              style: TextStyle(fontSize: 11, color: muted),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.download, size: 18),
                        onPressed: state.removingId == f.id
                            ? null
                            : () => _download(context, f),
                        tooltip: 'Download',
                      ),
                      if (canManage)
                        IconButton(
                          icon: state.removingId == f.id
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Icon(Icons.delete_outline, size: 18, color: AppColors.warn),
                          onPressed: state.removingId == f.id
                              ? null
                              : () => _remove(context, f.id),
                          tooltip: 'Remove',
                        ),
                    ],
                  ),
                ),

            if (files != null && files.isEmpty && canManage)
              Text(
                'Nothing attached yet.',
                style: TextStyle(fontSize: 12, color: muted),
              ),

            if (canManage) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: state.uploading ? null : () => _pickFile(context),
                  icon: state.uploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.attach_file, size: 18),
                  label: Text(state.uploading ? 'Uploading\u2026' : 'Attach a file'),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Attaching the same file twice keeps one copy.',
                style: TextStyle(
                  fontSize: 11,
                  color: muted,
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  IconData _iconForType(String contentType) {
    if (contentType.startsWith('image/')) return Icons.image_outlined;
    if (contentType.startsWith('video/')) return Icons.videocam_outlined;
    if (contentType.contains('pdf')) return Icons.picture_as_pdf_outlined;
    if (contentType.contains('spreadsheet') || contentType.contains('excel')) {
      return Icons.table_chart_outlined;
    }
    return Icons.insert_drive_file_outlined;
  }

  Future<void> _pickFile(BuildContext context) async {
    final cubit = context.read<BriefAttachmentsCubit>();
    final result = await FilePicker.pickFiles();
    if (result.isNotEmpty) {
      final file = result.first;
      if (file.path != null && context.mounted) {
        cubit.upload(file.path!, file.name);
      }
    }
  }

  /// FR-ASG — a file the teacher attached to the brief.
  ///
  /// The endpoint needs a bearer token, so there is no address to hand the
  /// system's browser: the bytes come through the client and are written to
  /// the app's documents directory.
  Future<void> _download(BuildContext context, BriefAttachment file) async {
    final cubit = context.read<BriefAttachmentsCubit>();
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      SnackBar(content: Text('Downloading ${file.filename}\u2026')),
    );
    try {
      final saved = await FileDownload.save(
        cubit.api,
        path: '/assignment-attachments/${file.id}/download',
        filename: file.filename,
      );
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(
        SnackBar(content: Text('Saved to ${saved.path}')),
      );
    } on ApiException {
      messenger.hideCurrentSnackBar();
      // ARC-045 — a file the System has lost is the Institute's problem, and
      // saying so is more useful than a status code.
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'That file could not be downloaded. Please tell your teacher.',
          ),
        ),
      );
    }
  }

  void _remove(BuildContext context, String id) {
    showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove file?'),
        content: const Text('This file will be removed from the brief.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    ).then((confirmed) {
      if (confirmed == true && context.mounted) {
        context.read<BriefAttachmentsCubit>().remove(id);
      }
    });
  }
}
