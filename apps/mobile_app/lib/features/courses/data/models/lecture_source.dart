/// Where a class's recordings come from — SRS §9.6, FR-VID-003.
library;

/// One folder in the Institute's lecture storage, as GET /storage/folders
/// reports it.
class StorageFolder {
  const StorageFolder({
    required this.id,
    required this.name,
    required this.modifiedAt,
    required this.url,
    required this.usedBy,
  });

  final String id;
  final String name;
  final DateTime? modifiedAt;
  final String? url;

  /// The class already reading this folder, if any.
  ///
  /// THIS IS THE POINT OF THE LIST. A dozen near-identical names — "(Sec D)
  /// English Class", "(Sec I) English Class" — with no indication of which
  /// are spoken for is how two classes end up reading one folder, silently,
  /// each cohort then seeing the other's recordings.
  final String? usedBy;

  bool get isTaken => usedBy != null && usedBy!.isNotEmpty;

  factory StorageFolder.fromJson(Map<String, dynamic> json) {
    final modified = json['modifiedAt'] as String?;
    return StorageFolder(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'Untitled folder',
      modifiedAt: modified == null ? null : DateTime.tryParse(modified)?.toLocal(),
      url: json['url'] as String?,
      usedBy: json['usedBy'] as String?,
    );
  }
}

class FolderIndex {
  const FolderIndex({
    required this.provider,
    required this.root,
    required this.folders,
    required this.looseFiles,
  });

  final String provider;
  final String root;
  final List<StorageFolder> folders;

  /// Recordings sitting in the root rather than in a class's folder. Worth
  /// showing: they belong to nobody and will never reach a student.
  final int looseFiles;

  factory FolderIndex.fromJson(Map<String, dynamic> json) {
    return FolderIndex(
      provider: json['provider'] as String? ?? 'local',
      root: json['root'] as String? ?? '',
      folders: (json['folders'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StorageFolder.fromJson)
          .toList(),
      looseFiles: json['looseFiles'] as int? ?? 0,
    );
  }
}

/// What a sync actually did. The COUNTS, not "done": an administrator who
/// presses the button needs to know whether anything arrived.
class SyncOutcome {
  const SyncOutcome({
    required this.added,
    required this.restored,
    required this.missing,
    required this.scanned,
    required this.blocked,
  });

  final int added;
  final int restored;
  final int missing;
  final int scanned;

  /// Catalogued but unplayable.
  ///
  /// A Drive folder can be perfectly readable while its files cannot be
  /// downloaded — the sharing option that stops viewers downloading. Every
  /// step succeeds, the cards appear, and playback is refused the first time
  /// a student presses play. It is one setting in Drive, so it is worth
  /// interrupting for rather than letting a student discover it.
  final int blocked;

  bool get nothingChanged => added == 0 && restored == 0 && missing == 0;

  factory SyncOutcome.fromJson(Map<String, dynamic> json) {
    return SyncOutcome(
      added: json['added'] as int? ?? 0,
      restored: json['restored'] as int? ?? 0,
      missing: json['missing'] as int? ?? 0,
      scanned: json['scanned'] as int? ?? 0,
      blocked: json['blocked'] as int? ?? 0,
    );
  }

  /// The sentence a person reads afterwards.
  String describe() {
    if (nothingChanged) {
      return 'Nothing new. $scanned recording${scanned == 1 ? '' : 's'} in the '
          'folder, all already here.';
    }
    final parts = <String>[
      if (added > 0) '$added new recording${added == 1 ? '' : 's'} added as drafts',
      if (restored > 0) '$restored came back',
      if (missing > 0) '$missing no longer in the folder',
    ];
    return '${parts.join(', ')}.';
  }
}
