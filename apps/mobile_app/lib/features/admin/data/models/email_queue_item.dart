class EmailQueueItem {
  const EmailQueueItem({
    required this.id,
    required this.kind,
    required this.status,
    required this.toAddress,
    required this.fullName,
    this.subject,
    required this.attempts,
    this.lastError,
    required this.createdAt,
    required this.nextAttemptAt,
    this.sentAt,
  });

  final String id;
  final String kind;
  final String status;
  final String toAddress;
  final String fullName;
  final String? subject;
  final int attempts;
  final String? lastError;
  final String createdAt;
  final String nextAttemptAt;
  final String? sentAt;

  factory EmailQueueItem.fromJson(Map<String, dynamic> json) {
    return EmailQueueItem(
      id: json['id'] as String? ?? '',
      kind: json['kind'] as String? ?? '',
      status: json['status'] as String? ?? '',
      toAddress: json['toAddress'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      subject: json['subject'] as String?,
      attempts: json['attempts'] as int? ?? 0,
      lastError: json['lastError'] as String?,
      createdAt: json['createdAt'] as String? ?? '',
      nextAttemptAt: json['nextAttemptAt'] as String? ?? '',
      sentAt: json['sentAt'] as String?,
    );
  }

  String get kindLabel {
    switch (kind) {
      case 'CREDENTIALS':
        return 'Sign-in details';
      case 'COURSE_ADDED':
        return 'Enrolled in a course';
      default:
        return kind;
    }
  }

  String get displaySubject => subject ?? kindLabel;
}
