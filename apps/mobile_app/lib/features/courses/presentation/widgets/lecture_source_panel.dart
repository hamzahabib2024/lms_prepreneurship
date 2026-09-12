import 'package:flutter/material.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../data/courses_repository.dart';
import 'lecture_folder_picker.dart';

/// WHERE THIS CLASS'S RECORDINGS COME FROM — FR-VID-003.
///
/// Staff only, and only shown when the server said `canManage`. A student has
/// no business knowing where the files live, which is why the server does not
/// send them the folder reference at all.
///
/// Three things in one panel because they are one job done in this order:
/// connect the folder, read it now, and publish what came back. Splitting
/// them across screens is how a class ends up catalogued and invisible —
/// cataloguing without publishing is half a feature.
class LectureSourcePanel extends StatefulWidget {
  const LectureSourcePanel({
    super.key,
    required this.repository,
    required this.sectionSubjectId,
    required this.folderRef,
    required this.onChanged,
  });

  final CoursesRepository repository;
  final String sectionSubjectId;

  /// The folder currently connected, or null when nothing arrives on its own.
  final String? folderRef;

  /// Reload the class — a sync changes which recordings exist.
  final Future<void> Function() onChanged;

  @override
  State<LectureSourcePanel> createState() => _LectureSourcePanelState();
}

class _LectureSourcePanelState extends State<LectureSourcePanel> {
  bool _busy = false;
  String? _note;
  String? _blocked;
  ApiException? _error;

  bool get _connected =>
      widget.folderRef != null && widget.folderRef!.isNotEmpty;

  Future<void> _pickFolder() async {
    final chosen = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => LectureFolderPicker(
          repository: widget.repository,
          currentRef: widget.folderRef,
        ),
      ),
    );
    // Saved straight away rather than dropped into a box for somebody to
    // press Save on. Choosing "use for this class" IS the instruction, and
    // making it two steps is how a class ends up connected to nothing.
    if (chosen != null) await _saveFolder(chosen);
  }

  Future<void> _saveFolder(String folderRef) async {
    setState(() {
      _busy = true;
      _error = null;
      _note = null;
      _blocked = null;
    });
    try {
      final saved = await widget.repository.setLectureFolder(
        sectionSubjectId: widget.sectionSubjectId,
        folderRef: folderRef,
      );
      await widget.onChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _note = saved == null || saved.isEmpty
            ? 'Folder disconnected.'
            : 'Folder saved. Check the folder to read it now.';
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  Future<void> _sync() async {
    setState(() {
      _busy = true;
      _error = null;
      _note = null;
      _blocked = null;
    });
    try {
      final outcome = await widget.repository.syncLectures(widget.sectionSubjectId);
      await widget.onChanged();
      if (!mounted) return;
      setState(() {
        _busy = false;
        // Catalogued but unplayable, said here rather than discovered by a
        // student. A Drive folder can be perfectly readable while its files
        // cannot be downloaded — every step succeeds, the cards appear, and
        // playback is refused the first time anybody presses play. It is one
        // setting in Drive, so it is worth interrupting for.
        if (outcome.blocked > 0) {
          _blocked = '${outcome.blocked} of ${outcome.scanned} recordings '
              'cannot be played yet: Google Drive is refusing to hand over the '
              'files. In Drive, open this class’s folder → Share '
              '→ the settings gear, and allow viewers to download. '
              'Nothing here can work around it.';
        } else {
          _note = outcome.describe();
        }
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  Future<void> _confirmDisconnect() async {
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disconnect this folder?'),
        content: const Text(
          'Nothing new will arrive on its own. Recordings already catalogued '
          'stay where they are.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (go == true) await _saveFolder('');
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.folder_outlined, size: 18, color: muted),
              const SizedBox(width: 8),
              const Text(
                'Where the recordings come from',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _connected
                ? 'Folder ${widget.folderRef} is connected and checked every '
                    'hour. Anything new arrives as a draft.'
                : 'No folder connected yet, so nothing arrives on its own.',
            style: TextStyle(fontSize: 12.5, color: muted),
          ),

          if (_error != null) ...[
            const SizedBox(height: 12),
            AppAlert(
              title: 'That did not work',
              message: _error!.message,
              details: serverDetailLines(_error!),
              reference: _error!.reference,
            ),
          ],
          if (_blocked != null) ...[
            const SizedBox(height: 12),
            AppAlert(
              title: 'Catalogued, but they will not play',
              message: _blocked!,
              warn: true,
            ),
          ],
          if (_note != null) ...[
            const SizedBox(height: 10),
            Text(
              _note!,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: dark ? AppColorsDark.ok : AppColors.ok,
              ),
            ),
          ],

          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: _busy ? null : _pickFolder,
                icon: const Icon(Icons.drive_folder_upload_outlined, size: 18),
                label: Text(_connected ? 'Change folder' : 'Connect a folder'),
              ),
              if (_connected)
                FilledButton.icon(
                  onPressed: _busy ? null : _sync,
                  icon: const Icon(Icons.sync, size: 18),
                  label: Text(_busy ? 'Checking…' : 'Check the folder'),
                ),
              if (_connected)
                TextButton(
                  onPressed: _busy ? null : _confirmDisconnect,
                  child: const Text('Disconnect'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
