/// A file entry from the configured storage — used when attaching recordings
/// to lessons. Maps `GET /storage/browse`.
class StorageEntry {
  const StorageEntry({
    required this.storageRef,
    required this.name,
    required this.isFolder,
    this.durationSeconds,
  });

  final String storageRef;
  final String name;
  final bool isFolder;
  final int? durationSeconds;

  factory StorageEntry.fromJson(Map<String, dynamic> json) => StorageEntry(
        storageRef: json['storageRef'] as String? ?? '',
        name: json['name'] as String? ?? '',
        isFolder: json['isFolder'] as bool? ?? false,
        durationSeconds: json['durationSeconds'] as int?,
      );
}
