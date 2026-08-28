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
    this.allowed,
    this.maxLength,
    this.multiline = false,
    this.isSecret = false,
    this.isSet = false,
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
  final List<String>? allowed;
  final int? maxLength;
  final bool multiline;
  final bool isSecret;
  final bool isSet;

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
      allowed: (json['allowed'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList(),
      maxLength: json['maxLength'] as int?,
      multiline: json['multiline'] as bool? ?? false,
      isSecret: json['isSecret'] as bool? ?? false,
      isSet: json['isSet'] as bool? ?? false,
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

  String get label {
    final parts = key.split('.');
    final last = parts.last;
    return last
        .replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}')
        .replaceFirstMapped(RegExp(r'^.'), (m) => m[1]!.toUpperCase());
  }

  String get groupName {
    final parts = key.split('.');
    if (parts.length < 2) return '';
    return parts[0];
  }
}
