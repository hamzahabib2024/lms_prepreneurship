class EmailQueueUsage {
  const EmailQueueUsage({
    required this.sent,
    required this.failed,
    required this.limit,
    required this.remaining,
    required this.percentUsed,
    required this.blocked,
    this.blockedSince,
    required this.byKind,
    required this.recent,
  });

  final int sent;
  final int failed;
  final int limit;
  final int remaining;
  final double percentUsed;
  final bool blocked;
  final String? blockedSince;
  final List<EmailKindUsage> byKind;
  final List<EmailRecentSend> recent;

  factory EmailQueueUsage.fromJson(Map<String, dynamic> json) {
    return EmailQueueUsage(
      sent: json['sent'] as int? ?? 0,
      failed: json['failed'] as int? ?? 0,
      limit: json['limit'] as int? ?? 0,
      remaining: json['remaining'] as int? ?? 0,
      percentUsed: (json['percentUsed'] as num?)?.toDouble() ?? 0,
      blocked: json['blocked'] as bool? ?? false,
      blockedSince: json['blockedSince'] as String?,
      byKind: (json['byKind'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(EmailKindUsage.fromJson)
          .toList(),
      recent: (json['recent'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(EmailRecentSend.fromJson)
          .toList(),
    );
  }
}

class EmailKindUsage {
  const EmailKindUsage({
    required this.kind,
    required this.label,
    required this.sent,
  });

  final String kind;
  final String label;
  final int sent;

  factory EmailKindUsage.fromJson(Map<String, dynamic> json) {
    return EmailKindUsage(
      kind: json['kind'] as String? ?? '',
      label: json['label'] as String? ?? '',
      sent: json['sent'] as int? ?? 0,
    );
  }
}

class EmailRecentSend {
  const EmailRecentSend({
    required this.occurredAt,
    required this.toAddress,
    required this.kind,
    required this.subject,
    required this.status,
  });

  final String occurredAt;
  final String toAddress;
  final String kind;
  final String subject;
  final String status;

  factory EmailRecentSend.fromJson(Map<String, dynamic> json) {
    return EmailRecentSend(
      occurredAt: json['occurredAt'] as String? ?? '',
      toAddress: json['toAddress'] as String? ?? '',
      kind: json['kind'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      status: json['status'] as String? ?? '',
    );
  }
}
