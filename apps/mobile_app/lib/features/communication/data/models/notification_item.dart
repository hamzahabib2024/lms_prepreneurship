class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    this.linkPath,
    this.readAt,
    required this.createdAt,
  });

  final String id;
  final String kind;
  final String title;
  final String body;
  final String? linkPath;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get isRead => readAt != null;

  factory NotificationItem.fromJson(Map<String, dynamic> json) {
    return NotificationItem(
      id: json['id'] as String,
      kind: json['kind'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      linkPath: json['linkPath'] as String?,
      readAt: json['readAt'] != null
          ? DateTime.parse(json['readAt'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

class InboxResponse {
  const InboxResponse({required this.unread, required this.items});

  final int unread;
  final List<NotificationItem> items;

  factory InboxResponse.fromJson(Map<String, dynamic> json) {
    return InboxResponse(
      unread: json['unread'] as int? ?? 0,
      items: (json['items'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(NotificationItem.fromJson)
          .toList(),
    );
  }
}
