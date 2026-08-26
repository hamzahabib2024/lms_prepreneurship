import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';

class LectureFolderPicker extends StatefulWidget {
  const LectureFolderPicker({
    super.key,
    required this.api,
    required this.courseId,
    required this.onFolderSelected,
  });

  final ApiClient api;
  final String courseId;
  final ValueChanged<String> onFolderSelected;

  @override
  State<LectureFolderPicker> createState() => _LectureFolderPickerState();
}

class _LectureFolderPickerState extends State<LectureFolderPicker> {
  List<FolderItem> _folders = [];
  bool _loading = true;
  String? _selectedFolderId;
  final String _currentPath = '';

  @override
  void initState() {
    super.initState();
    _loadFolders();
  }

  Future<void> _loadFolders() async {
    setState(() => _loading = true);
    try {
      final data = await widget.api.get<Map<String, dynamic>>(
        '/courses/${widget.courseId}/storage-folders',
      );
      final items = (data['folders'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FolderItem.fromJson)
          .toList();
      if (mounted) setState(() { _folders = items; _loading = false; });
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 300,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 20),
                const SizedBox(width: 8),
                const Expanded(child: Text('Select storage folder')),
                if (_selectedFolderId != null)
                  TextButton(
                    onPressed: () {
                      widget.onFolderSelected(_selectedFolderId!);
                      Navigator.of(context).pop();
                    },
                    child: const Text('Select'),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _folders.isEmpty
                    ? const Center(child: Text('No folders available'))
                    : ListView.builder(
                        itemCount: _folders.length,
                        itemBuilder: (context, index) {
                          final folder = _folders[index];
                          final selected = folder.id == _selectedFolderId;
                          return ListTile(
                            leading: Icon(
                              Icons.folder,
                              color: selected
                                  ? Theme.of(context).colorScheme.primary
                                  : AppColors.muted,
                            ),
                            title: Text(
                              folder.name,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                              ),
                            ),
                            subtitle: folder.childCount != null
                                ? Text('${folder.childCount} items', style: const TextStyle(fontSize: 12))
                                : null,
                            trailing: selected
                                ? Icon(Icons.check, color: Theme.of(context).colorScheme.primary, size: 20)
                                : null,
                            onTap: () => setState(() => _selectedFolderId = folder.id),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

class FolderItem {
  const FolderItem({
    required this.id,
    required this.name,
    this.childCount,
  });

  final String id;
  final String name;
  final int? childCount;

  factory FolderItem.fromJson(Map<String, dynamic> json) {
    return FolderItem(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      childCount: (json['childCount'] as num?)?.toInt(),
    );
  }
}
