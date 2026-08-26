class DiscussionPost {
  const DiscussionPost({
    required this.id,
    this.title,
    this.body,
    required this.removed,
    required this.removedByModerator,
    this.author,
    this.authorUserId,
    required this.isPinned,
    required this.isLocked,
    this.isAnonymous = false,
    this.identityVisible = true,
    this.endorsedAt,
    this.endorsedBy,
    this.resolvedAt,
    this.resolvedBy,
    this.editedAt,
    required this.createdAt,
    required this.replyCount,
    this.replies,
  });

  final String id;
  final String? title;
  final String? body;
  final bool removed;
  final bool removedByModerator;
  final String? author;
  final String? authorUserId;
  final bool isPinned;
  final bool isLocked;
  final bool isAnonymous;
  final bool identityVisible;
  final DateTime? endorsedAt;
  final String? endorsedBy;
  final DateTime? resolvedAt;
  final String? resolvedBy;
  final DateTime? editedAt;
  final DateTime createdAt;
  final int replyCount;
  final List<DiscussionPost>? replies;

  factory DiscussionPost.fromJson(Map<String, dynamic> json) {
    return DiscussionPost(
      id: json['id'] as String,
      title: json['title'] as String?,
      body: json['body'] as String?,
      removed: json['removed'] as bool? ?? false,
      removedByModerator: json['removedByModerator'] as bool? ?? false,
      author: json['author'] as String?,
      authorUserId: json['authorUserId'] as String?,
      isPinned: json['isPinned'] as bool? ?? false,
      isLocked: json['isLocked'] as bool? ?? false,
      isAnonymous: json['isAnonymous'] as bool? ?? false,
      identityVisible: json['identityVisible'] as bool? ?? true,
      endorsedAt: json['endorsedAt'] != null
          ? DateTime.parse(json['endorsedAt'] as String)
          : null,
      endorsedBy: json['endorsedBy'] as String?,
      resolvedAt: json['resolvedAt'] != null
          ? DateTime.parse(json['resolvedAt'] as String)
          : null,
      resolvedBy: json['resolvedBy'] as String?,
      editedAt: json['editedAt'] != null
          ? DateTime.parse(json['editedAt'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      replyCount: json['replyCount'] as int? ?? 0,
      replies: json['replies'] != null
          ? (json['replies'] as List<dynamic>)
              .whereType<Map<String, dynamic>>()
              .map(DiscussionPost.fromJson)
              .toList()
          : null,
    );
  }
}

class DiscussionThread extends DiscussionPost {
  const DiscussionThread({
    required super.id,
    super.title,
    super.body,
    required super.removed,
    required super.removedByModerator,
    super.author,
    super.authorUserId,
    required super.isPinned,
    required super.isLocked,
    super.isAnonymous,
    super.identityVisible,
    super.endorsedAt,
    super.endorsedBy,
    super.resolvedAt,
    super.resolvedBy,
    super.editedAt,
    required super.createdAt,
    required super.replyCount,
    required this.threadReplies,
  });

  final List<DiscussionPost> threadReplies;

  factory DiscussionThread.fromJson(Map<String, dynamic> json) {
    return DiscussionThread(
      id: json['id'] as String,
      title: json['title'] as String?,
      body: json['body'] as String?,
      removed: json['removed'] as bool? ?? false,
      removedByModerator: json['removedByModerator'] as bool? ?? false,
      author: json['author'] as String?,
      authorUserId: json['authorUserId'] as String?,
      isPinned: json['isPinned'] as bool? ?? false,
      isLocked: json['isLocked'] as bool? ?? false,
      isAnonymous: json['isAnonymous'] as bool? ?? false,
      identityVisible: json['identityVisible'] as bool? ?? true,
      endorsedAt: json['endorsedAt'] != null
          ? DateTime.parse(json['endorsedAt'] as String)
          : null,
      endorsedBy: json['endorsedBy'] as String?,
      resolvedAt: json['resolvedAt'] != null
          ? DateTime.parse(json['resolvedAt'] as String)
          : null,
      resolvedBy: json['resolvedBy'] as String?,
      editedAt: json['editedAt'] != null
          ? DateTime.parse(json['editedAt'] as String)
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      replyCount: json['replyCount'] as int? ?? 0,
      threadReplies: (json['replies'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(DiscussionPost.fromJson)
          .toList(),
    );
  }
}

class Offering {
  const Offering({required this.id, required this.label});

  final String id;
  final String label;
}
