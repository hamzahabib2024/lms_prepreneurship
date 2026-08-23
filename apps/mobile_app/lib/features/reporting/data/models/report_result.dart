class ReportResult {
  const ReportResult({
    required this.report,
    required this.generatedAt,
    required this.appliedFilters,
    required this.rowCount,
    this.durationMs,
    this.rows = const [],
    this.message,
  });

  final ReportMeta report;
  final DateTime generatedAt;
  final Map<String, dynamic> appliedFilters;
  final int rowCount;
  final int? durationMs;
  final List<Map<String, dynamic>> rows;
  final String? message;

  factory ReportResult.fromJson(Map<String, dynamic> json) {
    return ReportResult(
      report: ReportMeta.fromJson(
          json['report'] as Map<String, dynamic>? ?? {}),
      generatedAt: DateTime.tryParse(json['generatedAt'] as String? ?? '') ??
          DateTime.now(),
      appliedFilters:
          json['appliedFilters'] as Map<String, dynamic>? ?? const {},
      rowCount: json['rowCount'] as int? ?? 0,
      durationMs: json['durationMs'] as int?,
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(),
      message: json['message'] as String?,
    );
  }
}

class ReportMeta {
  const ReportMeta({required this.key, required this.name});

  final String key;
  final String name;

  factory ReportMeta.fromJson(Map<String, dynamic> json) {
    return ReportMeta(
      key: json['key'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }
}
