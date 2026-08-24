class SecurityEvent {
  const SecurityEvent({
    required this.id,
    required this.occurredAt,
    required this.eventType,
    this.outcome,
    this.userId,
    this.email,
    this.who,
    this.ipAddress,
    this.userAgent,
    this.detail,
    this.correlationId,
  });

  final String id;
  final String occurredAt;
  final String eventType;
  final String? outcome;
  final String? userId;
  final String? email;
  final String? who;
  final String? ipAddress;
  final String? userAgent;
  final Map<String, dynamic>? detail;
  final String? correlationId;

  factory SecurityEvent.fromJson(Map<String, dynamic> json) {
    return SecurityEvent(
      id: json['id'] as String? ?? '',
      occurredAt: json['occurredAt'] as String? ?? '',
      eventType: json['eventType'] as String? ?? '',
      outcome: json['outcome'] as String?,
      userId: json['userId'] as String?,
      email: json['email'] as String?,
      who: json['who'] as String?,
      ipAddress: json['ipAddress'] as String?,
      userAgent: json['userAgent'] as String?,
      detail: json['detail'] as Map<String, dynamic>?,
      correlationId: json['correlationId'] as String?,
    );
  }
}

class SecurityConcern {
  const SecurityConcern({
    required this.kind,
    required this.severity,
    required this.headline,
    this.advice,
    required this.count,
    this.subject,
    this.subjectKind,
    this.subjectName,
  });

  final String kind;
  final String severity;
  final String headline;
  final String? advice;
  final int count;
  final String? subject;
  final String? subjectKind;
  final String? subjectName;

  factory SecurityConcern.fromJson(Map<String, dynamic> json) {
    return SecurityConcern(
      kind: json['kind'] as String? ?? '',
      severity: json['severity'] as String? ?? 'LOW',
      headline: json['headline'] as String? ?? '',
      advice: json['advice'] as String?,
      count: json['count'] as int? ?? 0,
      subject: json['subject'] as String?,
      subjectKind: json['subjectKind'] as String?,
      subjectName: json['subjectName'] as String?,
    );
  }
}

class SecurityOverview {
  const SecurityOverview({
    required this.windowHours,
    required this.since,
    required this.tally,
    required this.concerns,
    this.message,
  });

  final int windowHours;
  final String since;
  final Map<String, dynamic> tally;
  final List<SecurityConcern> concerns;
  final String? message;

  factory SecurityOverview.fromJson(Map<String, dynamic> json) {
    return SecurityOverview(
      windowHours: json['windowHours'] as int? ?? 24,
      since: json['since'] as String? ?? '',
      tally: json['tally'] as Map<String, dynamic>? ?? const {},
      concerns: (json['concerns'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(SecurityConcern.fromJson)
          .toList(),
      message: json['message'] as String?,
    );
  }
}
