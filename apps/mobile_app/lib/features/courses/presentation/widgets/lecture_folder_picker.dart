import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../data/courses_repository.dart';
import '../../data/models/lecture_source.dart';

/// The Institute's lecture folders, by name and by id — FR-VID-003.
///
/// WHAT THIS REPLACES. Connecting a class to its recordings meant opening
/// Drive in another tab, finding the right folder among a dozen with names
/// like "(Sec D) English Class" and "(Sec I) English Class", copying the
/// address bar and pasting it back. The System could list that folder the
/// whole time; it simply never showed anybody the list.
///
/// OFFICE ONLY, enforced by the server on `lecture_storage_index` — a folder
/// id is close to a bearer token for that folder's contents, and a teacher
/// holding one could point their own class at another cohort's recordings. A
/// teacher who reaches this gets a 403 rather than a list, and the refusal is
/// shown as what it is rather than as an empty folder list.
///
/// IT SAYS WHICH FOLDERS ARE ALREADY SPOKEN FOR. Twelve near-identical names
/// with no indication of which are in use is how two classes end up reading
/// one folder — silently, each cohort then seeing the other's recordings.
///
/// Pops with the chosen folder id, or with null if the picker is dismissed.
class LectureFolderPicker extends StatefulWidget {
  const LectureFolderPicker({
    super.key,
    required this.repository,
    this.currentRef,
  });

  final CoursesRepository repository;

  /// The folder this class already uses, so it can be marked in the list.
  final String? currentRef;

  @override
  State<LectureFolderPicker> createState() => _LectureFolderPickerState();
}

class _LectureFolderPickerState extends State<LectureFolderPicker> {
  FolderIndex? _index;
  ApiException? _error;
  bool _loading = true;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final index = await widget.repository.storageFolders();
      if (!mounted) return;
      setState(() {
        _index = index;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _index = null;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final index = _index;

    final folders = index == null
        ? const <StorageFolder>[]
        : index.folders
            .where((f) =>
                _filter.isEmpty ||
                f.name.toLowerCase().contains(_filter.toLowerCase()))
            .toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lecture folders'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(20), child: SkeletonCards())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                children: [
                  if (_error != null)
                    AppAlert(
                      title: 'The lecture folders could not be read',
                      message: _error!.status == 403
                          ? 'Your account is not allowed to browse the '
                              'Institute’s storage. Ask the office to '
                              'connect this class to its folder.'
                          : _error!.message,
                      reference: _error!.reference,
                    )
                  else if (index != null) ...[
                    Text(
                      '${index.folders.length} folder'
                      '${index.folders.length == 1 ? '' : 's'} under '
                      '${index.root.isEmpty ? index.provider : index.root}',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                    if (index.looseFiles > 0) ...[
                      const SizedBox(height: 10),
                      AppAlert(
                        title: 'Recordings outside any folder',
                        message: '${index.looseFiles} recording'
                            '${index.looseFiles == 1 ? '' : 's'} sit in the '
                            'root rather than in a class’s folder, so no '
                            'class will ever read them.',
                        warn: true,
                      ),
                    ],
                    const SizedBox(height: 12),
                    TextField(
                      onChanged: (value) => setState(() => _filter = value),
                      decoration: const InputDecoration(
                        labelText: 'Filter by name',
                        prefixIcon: Icon(Icons.search, size: 20),
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (folders.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 20),
                        child: Text(
                          _filter.isEmpty
                              ? 'No folders found in the Institute’s '
                                  'lecture storage.'
                              : 'No folder matches “$_filter”.',
                          style: TextStyle(fontSize: 13, color: muted),
                        ),
                      )
                    else
                      for (final folder in folders)
                        _FolderRow(
                          folder: folder,
                          isCurrent: folder.id == widget.currentRef,
                          onUse: () => Navigator.of(context).pop(folder.id),
                          onCopyId: () => _copy(folder.id),
                        ),
                  ],
                ],
              ),
            ),
    );
  }

  Future<void> _copy(String id) async {
    await Clipboard.setData(ClipboardData(text: id));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Folder id copied')),
    );
  }
}

class _FolderRow extends StatelessWidget {
  const _FolderRow({
    required this.folder,
    required this.isCurrent,
    required this.onUse,
    required this.onCopyId,
  });

  final StorageFolder folder;
  final bool isCurrent;
  final VoidCallback onUse;
  final VoidCallback onCopyId;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      if (folder.modifiedAt != null) 'changed ${_ago(folder.modifiedAt!)}',
      if (folder.isTaken) 'used by ${folder.usedBy}',
    ];

    return ListRow(
      title: folder.name,
      subtitle: parts.isEmpty ? null : parts.join(' · '),
      // A folder already spoken for says so in words, not by colour alone.
      warn: folder.isTaken && !isCurrent,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: onCopyId,
            icon: const Icon(Icons.copy, size: 17),
            tooltip: 'Copy the folder id',
            visualDensity: VisualDensity.compact,
          ),
          if (isCurrent)
            const Pill(text: 'This class', kind: PillKind.ok)
          else
            OutlinedButton(
              onPressed: onUse,
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Use'),
            ),
        ],
      ),
    );
  }

  static String _ago(DateTime when) {
    final days = DateTime.now().difference(when).inDays;
    if (days <= 0) return 'today';
    if (days == 1) return 'yesterday';
    if (days < 30) return '$days days ago';
    final months = (days / 30).floor();
    return '$months month${months == 1 ? '' : 's'} ago';
  }
}
