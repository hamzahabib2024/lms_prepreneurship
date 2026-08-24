class SettingGroup {
  const SettingGroup({
    required this.group,
    required this.settings,
  });

  final String group;
  final List<SettingItem> settings;

  factory SettingGroup.fromJson(Map<String, dynamic> json) {
    return SettingGroup(
      group: json['group'] as String? ?? '',
      settings: (json['settings'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(SettingItem.fromJson)
          .toList(),
    );
  }
}

class SettingItem {
  const SettingItem({
    required this.key,
    required this.type,
    this.description,
    this.defaultValue,
    required this.source,
    this.scopeId,
    required this.isOverridden,
    this.overridableAt = const [],
    this.min,
    this.max,
    this.value,
  });

  final String key;
  final String type;
  final String? description;
  final dynamic defaultValue;
  final String source;
  final String? scopeId;
  final bool isOverridden;
  final List<String> overridableAt;
  final num? min;
  final num? max;
  final dynamic value;

  factory SettingItem.fromJson(Map<String, dynamic> json) {
    return SettingItem(
      key: json['key'] as String? ?? '',
      type: json['type'] as String? ?? 'text',
      description: json['description'] as String?,
      defaultValue: json['default'],
      source: json['source'] as String? ?? 'INSTITUTE',
      scopeId: json['scopeId'] as String?,
      isOverridden: json['isOverridden'] as bool? ?? false,
      overridableAt: (json['overridableAt'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
      min: json['min'] as num?,
      max: json['max'] as num?,
      value: json['value'],
    );
  }

  dynamic get displayValue => value ?? defaultValue;

  String get displayText {
    final v = displayValue;
    if (v == null) return '—';
    if (v is bool) return v ? 'On' : 'Off';
    if (type == 'percent') return '$v%';
    return v.toString();
  }
}
