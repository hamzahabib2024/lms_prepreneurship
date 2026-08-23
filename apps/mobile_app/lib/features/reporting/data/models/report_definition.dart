class ReportFilterSpec {
  const ReportFilterSpec({
    required this.key,
    required this.label,
    required this.type,
    this.required = false,
    this.hint,
  });

  final String key;
  final String label;
  final String type;
  final bool required;
  final String? hint;

  factory ReportFilterSpec.fromJson(Map<String, dynamic> json) {
    return ReportFilterSpec(
      key: json['key'] as String,
      label: json['label'] as String,
      type: json['type'] as String,
      required: json['required'] as bool? ?? false,
      hint: json['hint'] as String?,
    );
  }
}

class ReportDefinition {
  const ReportDefinition({
    required this.key,
    required this.name,
    required this.description,
    required this.columns,
    this.filters = const [],
  });

  final String key;
  final String name;
  final String description;
  final List<String> columns;
  final List<ReportFilterSpec> filters;

  bool get hasSectionFilter =>
      filters.any((f) => f.key == 'sectionId');
  bool get hasDateFilter =>
      filters.any((f) => f.type == 'date');
  bool get hasBooleanFilter =>
      filters.any((f) => f.type == 'boolean');

  factory ReportDefinition.fromJson(Map<String, dynamic> json) {
    return ReportDefinition(
      key: json['key'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      columns: (json['columns'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      filters: (json['filters'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ReportFilterSpec.fromJson)
          .toList(),
    );
  }
}
