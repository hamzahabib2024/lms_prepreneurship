/// Models for the class page — SRS §5.11, UC-15.
library;

class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.subject,
    required this.scheduledStart,
    required this.scheduledEnd,
    required this.status,
    required this.joinWindowOpensAt,
  });

  final String id;
  final String title;
  final String subject;
  final String scheduledStart;
  final String scheduledEnd;
  final String status;
  final String joinWindowOpensAt;

  factory SessionSummary.fromJson(Map<String, dynamic> json) {
    return SessionSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      scheduledStart: json['scheduledStart'] as String? ?? '',
      scheduledEnd: json['scheduledEnd'] as String? ?? '',
      status: json['status'] as String? ?? 'SCHEDULED',
      joinWindowOpensAt: json['joinWindowOpensAt'] as String? ?? '',
    );
  }
}

class JoinRoute {
  const JoinRoute({
    required this.session,
    required this.kind,
    this.url,
    this.opensInNewTab,
    this.internalPath,
    this.token,
    this.reasonCode,
    this.message,
    this.retryAfter,
  });

  final SessionSummary session;
  final String kind;
  final String? url;
  final bool? opensInNewTab;
  final String? internalPath;
  final String? token;
  final String? reasonCode;
  final String? message;
  final String? retryAfter;

  factory JoinRoute.fromJson(Map<String, dynamic> json) {
    return JoinRoute(
      session: SessionSummary.fromJson(
          json['session'] as Map<String, dynamic>? ?? const {}),
      kind: json['kind'] as String? ?? 'UNAVAILABLE',
      url: json['url'] as String?,
      opensInNewTab: json['opensInNewTab'] as bool?,
      internalPath: json['internalPath'] as String?,
      token: json['token'] as String?,
      reasonCode: json['reasonCode'] as String?,
      message: json['message'] as String?,
      retryAfter: json['retryAfter'] as String?,
    );
  }

  bool get isExternalRedirect => kind == 'EXTERNAL_REDIRECT';
  bool get isEmbeddedRoute => kind == 'EMBEDDED_ROUTE';
  bool get isUnavailable => kind == 'UNAVAILABLE';
}
