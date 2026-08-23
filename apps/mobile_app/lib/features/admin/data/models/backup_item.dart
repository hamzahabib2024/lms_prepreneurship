class BackupItem {
  const BackupItem({
    required this.id,
    required this.takenAt,
    this.age,
    required this.totalRows,
    required this.sizeBytes,
    this.schemaVersion,
    required this.broken,
  });

  final String id;
  final String takenAt;
  final String? age;
  final int totalRows;
  final int sizeBytes;
  final String? schemaVersion;
  final bool broken;

  factory BackupItem.fromJson(Map<String, dynamic> json) {
    return BackupItem(
      id: json['id'] as String? ?? '',
      takenAt: json['takenAt'] as String? ?? '',
      age: json['age'] as String?,
      totalRows: json['totalRows'] as int? ?? 0,
      sizeBytes: json['sizeBytes'] as int? ?? 0,
      schemaVersion: json['schemaVersion'] as String?,
      broken: json['broken'] as bool? ?? false,
    );
  }

  String get sizeLabel {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) return '${(sizeBytes / 1024).round()} KB';
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
