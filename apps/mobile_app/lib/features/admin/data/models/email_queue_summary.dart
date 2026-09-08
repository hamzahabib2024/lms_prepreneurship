import 'email_queue_item.dart';
import 'email_queue_usage.dart';

class EmailQueueSummary {
  const EmailQueueSummary({
    required this.awaitingApproval,
    required this.retrying,
    required this.abandoned,
    required this.sentToday,
    required this.requiresApproval,
    required this.usage,
    required this.rows,
  });

  final int awaitingApproval;
  final int retrying;
  final int abandoned;
  final int sentToday;
  final bool requiresApproval;
  final EmailQueueUsage usage;
  final List<EmailQueueItem> rows;

  factory EmailQueueSummary.fromJson(Map<String, dynamic> json) {
    return EmailQueueSummary(
      awaitingApproval: json['awaitingApproval'] as int? ?? 0,
      retrying: json['retrying'] as int? ?? 0,
      abandoned: json['abandoned'] as int? ?? 0,
      sentToday: json['sentToday'] as int? ?? 0,
      requiresApproval: json['requiresApproval'] as bool? ?? false,
      usage: json['usage'] != null
          ? EmailQueueUsage.fromJson(json['usage'] as Map<String, dynamic>)
          : const EmailQueueUsage(
              sent: 0,
              failed: 0,
              limit: 0,
              remaining: 0,
              percentUsed: 0,
              blocked: false,
              byKind: [],
              recent: [],
            ),
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(EmailQueueItem.fromJson)
          .toList(),
    );
  }
}
