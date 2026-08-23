class Announcement {
  const Announcement({
    required this.id,
    required this.audience,
    required this.title,
    required this.body,
    required this.isPinned,
    required this.isUrgent,
    this.priority,
    required this.publishedAt,
    required this.authorName,
    required this.about,
    this.expiresAt,
  });

  final String id;
  final String audience;
  final String title;
  final String body;
  final bool isPinned;
  final bool isUrgent;
  final String? priority;
  final DateTime publishedAt;
  final String authorName;
  final String about;
  final DateTime? expiresAt;

  factory Announcement.fromJson(Map<String, dynamic> json) {
    return Announcement(
      id: json['id'] as String,
      audience: json['audience'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      isPinned: json['isPinned'] as bool? ?? false,
      isUrgent: json['isUrgent'] as bool? ?? false,
      priority: json['priority'] as String?,
      publishedAt: DateTime.parse(json['publishedAt'] as String),
      authorName: json['authorName'] as String? ?? '',
      about: json['about'] as String? ?? '',
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : null,
    );
  }

  String get priorityLabel {
    final p = priority ?? (isUrgent ? 'URGENT' : 'NORMAL');
    switch (p) {
      case 'URGENT':
        return 'Urgent';
      case 'IMPORTANT':
        return 'Important';
      default:
        return '';
    }
  }
}
