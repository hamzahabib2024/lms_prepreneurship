class BulkReport {
  const BulkReport({
    this.section,
    required this.total,
    required this.succeeded,
    required this.failed,
    required this.skipped,
    this.rows = const [],
    this.summary,
  });

  final Map<String, dynamic>? section;
  final int total;
  final int succeeded;
  final int failed;
  final int skipped;
  final List<BulkRow> rows;
  final String? summary;

  factory BulkReport.fromJson(Map<String, dynamic> json) {
    return BulkReport(
      section: json['section'] as Map<String, dynamic>?,
      total: json['total'] as int? ?? 0,
      succeeded: json['succeeded'] as int? ?? 0,
      failed: json['failed'] as int? ?? 0,
      skipped: json['skipped'] as int? ?? 0,
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(BulkRow.fromJson)
          .toList(),
      summary: json['summary'] as String?,
    );
  }
}

class BulkRow {
  const BulkRow({
    this.studentId,
    this.name,
    required this.outcome,
    this.message,
  });

  final String? studentId;
  final String? name;
  final String outcome;
  final String? message;

  factory BulkRow.fromJson(Map<String, dynamic> json) {
    return BulkRow(
      studentId: json['studentId'] as String?,
      name: json['name'] as String?,
      outcome: json['outcome'] as String? ?? '',
      message: json['message'] as String?,
    );
  }
}

class CohortImportResult {
  const CohortImportResult({
    this.sectionId,
    this.sectionName,
    required this.loaded,
    required this.rejoined,
    required this.skipped,
    this.outcomes = const [],
    required this.emailed,
    required this.notEmailed,
    this.message,
  });

  final String? sectionId;
  final String? sectionName;
  final int loaded;
  final int rejoined;
  final int skipped;
  final List<CohortRowOutcome> outcomes;
  final int emailed;
  final int notEmailed;
  final String? message;

  factory CohortImportResult.fromJson(Map<String, dynamic> json) {
    return CohortImportResult(
      sectionId: json['sectionId'] as String?,
      sectionName: json['sectionName'] as String?,
      loaded: json['loaded'] as int? ?? 0,
      rejoined: json['rejoined'] as int? ?? 0,
      skipped: json['skipped'] as int? ?? 0,
      outcomes: (json['outcomes'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CohortRowOutcome.fromJson)
          .toList(),
      emailed: json['emailed'] as int? ?? 0,
      notEmailed: json['notEmailed'] as int? ?? 0,
      message: json['message'] as String?,
    );
  }
}

class CohortRowOutcome {
  const CohortRowOutcome({
    required this.line,
    this.fullName,
    this.email,
    this.status,
    this.registrationNo,
    this.rollNo,
    this.temporaryPassword,
    this.emailSent,
  });

  final int line;
  final String? fullName;
  final String? email;
  final String? status;
  final String? registrationNo;
  final int? rollNo;
  final String? temporaryPassword;
  final bool? emailSent;

  factory CohortRowOutcome.fromJson(Map<String, dynamic> json) {
    return CohortRowOutcome(
      line: json['line'] as int? ?? 0,
      fullName: json['fullName'] as String?,
      email: json['email'] as String?,
      status: json['status'] as String?,
      registrationNo: json['registrationNo'] as String?,
      rollNo: json['rollNo'] as int?,
      temporaryPassword: json['temporaryPassword'] as String?,
      emailSent: json['emailSent'] as bool?,
    );
  }
}
