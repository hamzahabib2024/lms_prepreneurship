import 'package:equatable/equatable.dart';

class PublicField extends Equatable {
  const PublicField({
    required this.key,
    required this.type,
    required this.description,
    this.defaultValue,
    this.value,
    this.isOverridden = false,
    this.maxLength,
    this.multiline = false,
  });

  final String key;
  final String type;
  final String description;
  final dynamic defaultValue;
  final dynamic value;
  final bool isOverridden;
  final int? maxLength;
  final bool multiline;

  dynamic get currentValue => value ?? defaultValue;

  factory PublicField.fromJson(Map<String, dynamic> json) {
    return PublicField(
      key: json['key'] as String,
      type: json['type'] as String,
      description: json['description'] as String? ?? '',
      defaultValue: json['default'],
      value: json['value'],
      isOverridden: json['isOverridden'] as bool? ?? false,
      maxLength: json['maxLength'] as int?,
      multiline: json['multiline'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [key, type, description, defaultValue, value, isOverridden, maxLength, multiline];
}

class PublicNotice extends Equatable {
  const PublicNotice({
    required this.id,
    required this.title,
    required this.publishedAt,
    this.isPinned = false,
    this.expiresAt,
  });

  final String id;
  final String title;
  final String publishedAt;
  final bool isPinned;
  final String? expiresAt;

  factory PublicNotice.fromJson(Map<String, dynamic> json) {
    return PublicNotice(
      id: json['id'] as String,
      title: json['title'] as String,
      publishedAt: json['publishedAt'] as String,
      isPinned: json['isPinned'] as bool? ?? false,
      expiresAt: json['expiresAt'] as String?,
    );
  }

  @override
  List<Object?> get props => [id, title, publishedAt, isPinned, expiresAt];
}

class PublicDocument extends Equatable {
  const PublicDocument({
    this.fields = const [],
    this.instituteName = '',
    this.news = const [],
    this.previewPath = '/home',
  });

  final List<PublicField> fields;
  final String instituteName;
  final List<PublicNotice> news;
  final String previewPath;

  factory PublicDocument.fromJson(Map<String, dynamic> json) {
    return PublicDocument(
      fields: (json['fields'] as List<dynamic>?)
              ?.map((e) => PublicField.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      instituteName: json['instituteName'] as String? ?? '',
      news: (json['news'] as List<dynamic>?)
              ?.map((e) => PublicNotice.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      previewPath: json['previewPath'] as String? ?? '/home',
    );
  }

  @override
  List<Object?> get props => [fields, instituteName, news, previewPath];
}

class SaveResult extends Equatable {
  const SaveResult({
    this.changed = const [],
    this.restored = const [],
    this.note = '',
  });

  final List<String> changed;
  final List<String> restored;
  final String note;

  factory SaveResult.fromJson(Map<String, dynamic> json) {
    return SaveResult(
      changed: (json['changed'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
      restored: (json['restored'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
      note: json['note'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [changed, restored, note];
}
