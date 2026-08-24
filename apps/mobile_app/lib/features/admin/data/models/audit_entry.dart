class AuditEntry {
  const AuditEntry({
    required this.id,
    required this.occurredAt,
    required this.action,
    this.entityType,
    this.entityId,
    this.actor,
    this.actorUserId,
    this.actorRole,
    this.impersonatedBy,
    this.beforeValue,
    this.afterValue,
    this.ipAddress,
    this.correlationId,
  });

  final String id;
  final String occurredAt;
  final String action;
  final String? entityType;
  final String? entityId;
  final String? actor;
  final String? actorUserId;
  final String? actorRole;
  final String? impersonatedBy;
  final Map<String, dynamic>? beforeValue;
  final Map<String, dynamic>? afterValue;
  final String? ipAddress;
  final String? correlationId;

  factory AuditEntry.fromJson(Map<String, dynamic> json) {
    return AuditEntry(
      id: json['id'] as String? ?? '',
      occurredAt: json['occurredAt'] as String? ?? '',
      action: json['action'] as String? ?? '',
      entityType: json['entityType'] as String?,
      entityId: json['entityId'] as String?,
      actor: json['actor'] as String?,
      actorUserId: json['actorUserId'] as String?,
      actorRole: json['actorRole'] as String?,
      impersonatedBy: json['impersonatedBy'] as String?,
      beforeValue: json['before'] as Map<String, dynamic>?,
      afterValue: json['after'] as Map<String, dynamic>?,
      ipAddress: json['ipAddress'] as String?,
      correlationId: json['correlationId'] as String?,
    );
  }
}

class AuditActionCount {
  const AuditActionCount({required this.action, required this.count});

  final String action;
  final int count;

  factory AuditActionCount.fromJson(Map<String, dynamic> json) {
    return AuditActionCount(
      action: json['action'] as String? ?? '',
      count: json['count'] as int? ?? 0,
    );
  }
}
