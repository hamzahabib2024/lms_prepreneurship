import 'package:equatable/equatable.dart';

class RenderedPreview extends Equatable {
  const RenderedPreview({
    this.title = '',
    this.body = '',
    this.missing = const [],
  });

  final String title;
  final String body;
  final List<String> missing;

  factory RenderedPreview.fromJson(Map<String, dynamic> json) {
    return RenderedPreview(
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      missing: (json['missing'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          [],
    );
  }

  @override
  List<Object?> get props => [title, body, missing];
}

class NotificationTemplate extends Equatable {
  const NotificationTemplate({
    required this.kind,
    required this.label,
    this.description = '',
    this.placeholders = const [],
    this.title = '',
    this.body = '',
    this.defaultTitle = '',
    this.defaultBody = '',
    this.source = 'DEFAULT',
    this.updatedAt,
    this.preview,
  });

  final String kind;
  final String label;
  final String description;
  final List<String> placeholders;
  final String title;
  final String body;
  final String defaultTitle;
  final String defaultBody;
  final String source;
  final String? updatedAt;
  final RenderedPreview? preview;

  bool get isCustomized => source == 'INSTITUTE';

  factory NotificationTemplate.fromJson(Map<String, dynamic> json) {
    return NotificationTemplate(
      kind: json['kind'] as String,
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
      placeholders: (json['placeholders'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          [],
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      defaultTitle: json['defaultTitle'] as String? ?? '',
      defaultBody: json['defaultBody'] as String? ?? '',
      source: json['source'] as String? ?? 'DEFAULT',
      updatedAt: json['updatedAt'] as String?,
      preview: json['preview'] != null
          ? RenderedPreview.fromJson(json['preview'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [kind, label, title, body, source, updatedAt];
}
