import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

class AssignmentAttachmentsSection extends StatelessWidget {
  const AssignmentAttachmentsSection({
    super.key,
    required this.attachments,
    required this.onAdd,
    required this.onRemove,
    this.enabled = true,
  });

  final List<AssignmentAttachment> attachments;
  final ValueChanged<List<PlatformFile>> onAdd;
  final ValueChanged<int> onRemove;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('Attachments', style: theme.textTheme.titleSmall),
            const Spacer(),
            if (enabled)
              TextButton.icon(
                onPressed: _pickFiles,
                icon: const Icon(Icons.attach_file, size: 16),
                label: const Text('Add files'),
              ),
          ],
        ),
        if (attachments.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'No files attached',
              style: TextStyle(color: muted, fontSize: 13),
            ),
          )
        else
          for (int i = 0; i < attachments.length; i++)
            _AttachmentTile(
              attachment: attachments[i],
              onRemove: enabled ? () => onRemove(i) : null,
            ),
      ],
    );
  }

  void _pickFiles() async {
    final result = await FilePicker.platform.pickFiles(
      allowMultiple: true,
      withData: true,
    );
    if (result != null && result.files.isNotEmpty) {
      onAdd(result.files);
    }
  }
}

class AssignmentAttachment {
  const AssignmentAttachment({
    required this.name,
    required this.bytes,
    this.id,
    this.url,
  });

  final String name;
  final List<int> bytes;
  final String? id;
  final String? url;

  bool get isUploaded => id != null || url != null;
}

class _AttachmentTile extends StatelessWidget {
  const _AttachmentTile({required this.attachment, this.onRemove});

  final AssignmentAttachment attachment;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    final icon = _iconForFile(attachment.name);

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: muted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              attachment.name,
              style: const TextStyle(fontSize: 13),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (onRemove != null)
            GestureDetector(
              onTap: onRemove,
              child: Icon(Icons.close, size: 16, color: muted),
            ),
        ],
      ),
    );
  }

  IconData _iconForFile(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return Icons.picture_as_pdf_outlined;
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) return Icons.description_outlined;
    if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return Icons.table_chart_outlined;
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
      return Icons.image_outlined;
    }
    return Icons.insert_drive_file_outlined;
  }
}
