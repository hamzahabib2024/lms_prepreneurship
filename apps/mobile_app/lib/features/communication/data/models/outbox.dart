class OutboxResult {
  const OutboxResult({
    required this.messages,
    required this.held,
    required this.limit,
    required this.note,
  });

  final List<OutboxMessage> messages;
  final int held;
  final int limit;
  final String note;

  factory OutboxResult.fromJson(Map<String, dynamic> json) {
    return OutboxResult(
      messages: (json['messages'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(OutboxMessage.fromJson)
          .toList(),
      held: json['held'] as int? ?? 0,
      limit: json['limit'] as int? ?? 50,
      note: json['note'] as String? ?? '',
    );
  }
}

class OutboxMessage {
  const OutboxMessage({
    required this.at,
    required this.channel,
    required this.kind,
    required this.recipientName,
    required this.destination,
    required this.title,
    required this.body,
    required this.isUrgent,
  });

  final String at;
  final String channel;
  final String kind;
  final String recipientName;
  final String destination;
  final String title;
  final String body;
  final bool isUrgent;

  factory OutboxMessage.fromJson(Map<String, dynamic> json) {
    return OutboxMessage(
      at: json['at'] as String? ?? '',
      channel: json['channel'] as String? ?? '',
      kind: json['kind'] as String? ?? '',
      recipientName: json['recipientName'] as String? ?? '',
      destination: json['destination'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      isUrgent: json['isUrgent'] as bool? ?? false,
    );
  }
}
