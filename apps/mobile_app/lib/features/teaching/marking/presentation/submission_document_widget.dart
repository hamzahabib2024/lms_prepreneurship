import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path_provider/path_provider.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';

class SubmissionDocumentWidget extends StatefulWidget {
  const SubmissionDocumentWidget({
    super.key,
    required this.files,
    this.textResponse,
  });

  final List<SubmissionFileRef> files;
  final String? textResponse;

  @override
  State<SubmissionDocumentWidget> createState() =>
      _SubmissionDocumentWidgetState();
}

class _SubmissionDocumentWidgetState extends State<SubmissionDocumentWidget> {
  int _selectedIndex = 0;
  bool _downloading = false;
  String? _downloadError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;

    if (widget.files.isEmpty && widget.textResponse == null) {
      return Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: dark ? AppColorsDark.surface : AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        ),
        child: Center(
          child: Column(
            children: [
              Icon(
                Icons.assignment_late_outlined,
                size: 32,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
              const SizedBox(height: 8),
              Text(
                'Nothing was handed in with this submission.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.files.length > 1)
            _buildFileTabs(dark),

          if (widget.files.isNotEmpty)
            _buildFileView(widget.files[_selectedIndex], dark),

          if (widget.textResponse != null) ...[
            const Divider(height: 1),
            _buildTextResponse(dark),
          ],
        ],
      ),
    );
  }

  Widget _buildFileTabs(bool dark) {
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: List.generate(widget.files.length, (i) {
            final file = widget.files[i];
            final isSelected = i == _selectedIndex;

            return GestureDetector(
              onTap: () => setState(() => _selectedIndex = i),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: isSelected
                          ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                          : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: Text(
                  file.filename,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: isSelected
                        ? (dark ? AppColorsDark.ink : AppColors.ink)
                        : (dark ? AppColorsDark.muted : AppColors.muted),
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildFileView(SubmissionFileRef file, bool dark) {
    final theme = Theme.of(context);
    final viewable = _isViewable(file.contentType);

    return Container(
      height: 200,
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                _getFileIcon(file.contentType),
                size: 20,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      file.filename,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${_formatSize(file.sizeBytes)} • ${_getExtension(file.contentType)}',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.download, size: 20),
                onPressed: _downloading ? null : () => _downloadFile(file),
                tooltip: 'Download',
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _downloading
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        const SizedBox(height: 8),
                        Text(
                          'Downloading ${file.filename}...',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  )
                : _downloadError != null
                    ? Center(
                        child: Text(
                          _downloadError!,
                          style: TextStyle(color: AppColors.error),
                        ),
                      )
                    : viewable
                        ? Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  _getFileIcon(file.contentType),
                                  size: 48,
                                  color: dark
                                      ? AppColorsDark.brand600
                                      : AppColors.brand600,
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Preview available',
                                  style: theme.textTheme.labelMedium?.copyWith(
                                    color: dark ? AppColorsDark.muted : AppColors.muted,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                TextButton(
                                  onPressed: () => _openFile(file),
                                  child: const Text('Open'),
                                ),
                              ],
                            ),
                          )
                        : Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.insert_drive_file_outlined,
                                  size: 48,
                                  color: dark ? AppColorsDark.muted : AppColors.muted,
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'This file type cannot be previewed',
                                  style: theme.textTheme.labelMedium?.copyWith(
                                    color: dark ? AppColorsDark.muted : AppColors.muted,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                TextButton(
                                  onPressed: () => _downloadFile(file),
                                  child: const Text('Download to view'),
                                ),
                              ],
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextResponse(bool dark) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Typed answer',
            style: theme.textTheme.labelMedium?.copyWith(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: dark ? AppColorsDark.surface2 : AppColors.surface2,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              widget.textResponse!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: dark ? AppColorsDark.ink : AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }

  bool _isViewable(String contentType) {
    const viewable = {
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    };
    return viewable.contains(contentType);
  }

  IconData _getFileIcon(String contentType) {
    if (contentType.startsWith('image/')) return Icons.image;
    if (contentType == 'application/pdf') return Icons.picture_as_pdf;
    if (contentType.contains('word') || contentType.contains('document')) {
      return Icons.description;
    }
    if (contentType.contains('spreadsheet') || contentType.contains('excel')) {
      return Icons.table_chart;
    }
    if (contentType.startsWith('video/')) return Icons.video_file;
    if (contentType.startsWith('audio/')) return Icons.audio_file;
    return Icons.insert_drive_file;
  }

  String _formatSize(int bytes) {
    if (bytes >= 1048576) {
      return '${(bytes / 1048576).toStringAsFixed(1)} MB';
    }
    return '${(bytes / 1024).round()} KB';
  }

  String _getExtension(String contentType) {
    const mimeMap = {
      'application/pdf': 'PDF',
      'image/jpeg': 'JPEG',
      'image/png': 'PNG',
      'image/webp': 'WebP',
      'image/gif': 'GIF',
      'application/msword': 'DOC',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
      'application/vnd.ms-excel': 'XLS',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    };
    return mimeMap[contentType] ?? contentType.split('/').last.toUpperCase();
  }

  Future<void> _downloadFile(SubmissionFileRef file) async {
    setState(() {
      _downloading = true;
      _downloadError = null;
    });

    try {
      final api = context.read<ApiClient>();
      final bytes = await api.bytes('/submission-files/${file.id}/download');

      final dir = await getTemporaryDirectory();
      final filePath = '${dir.path}/${file.filename}';
      final savedFile = File(filePath);
      await savedFile.writeAsBytes(bytes);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Downloaded ${file.filename}'),
            action: SnackBarAction(
              label: 'Open',
              onPressed: () => _openFile(file),
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _downloadError = 'Failed to download: $e');
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  Future<void> _openFile(SubmissionFileRef file) async {
    try {
      final api = context.read<ApiClient>();
      final bytes = await api.bytes('/submission-files/${file.id}/download');

      final dir = await getTemporaryDirectory();
      final filePath = '${dir.path}/${file.filename}';
      final savedFile = File(filePath);
      await savedFile.writeAsBytes(bytes);

      // Use share_plus or open_file if available
      // For now, just show a snackbar
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('File saved to: $filePath'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to open file: $e')),
        );
      }
    }
  }
}

class SubmissionFileRef {
  const SubmissionFileRef({
    required this.id,
    required this.filename,
    required this.contentType,
    required this.sizeBytes,
  });

  final String id;
  final String filename;
  final String contentType;
  final int sizeBytes;
}
