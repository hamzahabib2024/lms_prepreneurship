/// Enrolment lifecycle — SRS §5.4, the state machine at Figure 12-10.
///
/// One rule governs the shapes here: enrolment history is RETAINED across
/// transfer, suspension and withdrawal (BR-ENR-10). Rows are never deleted;
/// states transition. `status` values are ACTIVE, SUSPENDED, WITHDRAWN,
/// TRANSFERRED and COMPLETED.
library;

/// One student as the section roster reports them (FR-ENR-012).
///
/// Contact details are absent deliberately: §4.7 restricts them to Admin, and
/// a roster is the surface a teacher sees most often.
class RosterRow {
  const RosterRow({
    required this.studentId,
    required this.rollNo,
    required this.registrationNo,
    required this.name,
    required this.accountStatus,
    required this.subjects,
    this.photoUrl,
  });

  final String studentId;
  final int? rollNo;
  final String registrationNo;
  final String name;
  final String? photoUrl;
  final String accountStatus;
  final List<String> subjects;

  factory RosterRow.fromJson(Map<String, dynamic> json) {
    return RosterRow(
      studentId: json['studentId'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      registrationNo: json['registrationNo'] as String? ?? '',
      name: json['name'] as String? ?? '',
      photoUrl: json['photoUrl'] as String?,
      accountStatus: json['accountStatus'] as String? ?? 'ACTIVE',
      subjects: (json['subjects'] as List<dynamic>? ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }
}

/// One row of a student's enrolment history (FR-ENR-021) — a subject-within-
/// a-section the student has ever been enrolled in. Closed rows keep their
/// roll number so the historical register still reads correctly.
class EnrolmentRow {
  const EnrolmentRow({
    required this.id,
    required this.subjectCode,
    required this.subjectName,
    required this.sectionCode,
    required this.sectionName,
    required this.status,
    required this.rollNoAtEnrolment,
    required this.enrolledAt,
    this.endedAt,
    this.reason,
  });

  final String id;
  final String subjectCode;
  final String subjectName;
  final String sectionCode;
  final String sectionName;
  final String status;
  final int? rollNoAtEnrolment;
  final DateTime? enrolledAt;
  final DateTime? endedAt;
  final String? reason;

  factory EnrolmentRow.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final section = json['section'] as Map<String, dynamic>? ?? const {};
    return EnrolmentRow(
      id: json['id'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
      sectionName: section['name'] as String? ?? '',
      status: json['status'] as String? ?? '',
      rollNoAtEnrolment: json['rollNoAtEnrolment'] as int?,
      enrolledAt:
          DateTime.tryParse(json['enrolledAt'] as String? ?? ''),
      endedAt: DateTime.tryParse(json['endedAt'] as String? ?? ''),
      reason: json['reason'] as String?,
    );
  }
}

/// POST /students/:id/transfer — what a transfer did (FR-ENR-005/006).
///
/// The registration number never changes (BR-REG-07); a new roll number is
/// allocated in the destination; source enrolments close as TRANSFERRED.
class TransferResult {
  const TransferResult({
    required this.studentId,
    required this.registrationNo,
    required this.fromId,
    required this.fromCode,
    required this.fromName,
    required this.toId,
    required this.toCode,
    required this.toName,
    required this.newRollNo,
    required this.subjectsEnrolled,
  });

  final String studentId;
  final String registrationNo;

  /// Null when the student had no current section (a never-placed admission).
  final String? fromId;
  final String? fromCode;
  final String? fromName;

  final String toId;
  final String toCode;
  final String toName;
  final int? newRollNo;
  final int subjectsEnrolled;

  factory TransferResult.fromJson(Map<String, dynamic> json) {
    final from = json['from'] as Map<String, dynamic>?;
    final to = json['to'] as Map<String, dynamic>? ?? const {};
    return TransferResult(
      studentId: json['studentId'] as String? ?? '',
      registrationNo: json['registrationNo'] as String? ?? '',
      fromId: from?['id'] as String?,
      fromCode: from?['code'] as String?,
      fromName: from?['name'] as String?,
      toId: to['id'] as String? ?? '',
      toCode: to['code'] as String? ?? '',
      toName: to['name'] as String? ?? '',
      newRollNo: json['newRollNo'] as int?,
      subjectsEnrolled: json['subjectsEnrolled'] as int? ?? 0,
    );
  }
}

/// POST /students/:id/suspend — an account suspension (FR-ENR-007/008).
class SuspensionResult {
  const SuspensionResult({
    required this.studentId,
    required this.status,
    required this.reason,
  });

  final String studentId;
  final String status;
  final String reason;

  factory SuspensionResult.fromJson(Map<String, dynamic> json) {
    return SuspensionResult(
      studentId: json['studentId'] as String? ?? '',
      status: json['status'] as String? ?? 'SUSPENDED',
      reason: json['reason'] as String? ?? '',
    );
  }
}

/// POST /students/:id/withdraw — withdrawal frees the roll number for reuse
/// within the section (BR-REG-08) but never the registration number.
class WithdrawalResult {
  const WithdrawalResult({
    required this.studentId,
    required this.status,
    required this.registrationNo,
    required this.rollNumberReleased,
  });

  final String studentId;
  final String status;
  final String registrationNo;
  final int? rollNumberReleased;

  factory WithdrawalResult.fromJson(Map<String, dynamic> json) {
    return WithdrawalResult(
      studentId: json['studentId'] as String? ?? '',
      status: json['status'] as String? ?? 'WITHDRAWN',
      registrationNo: json['registrationNo'] as String? ?? '',
      rollNumberReleased: json['rollNumberReleased'] as int?,
    );
  }
}

/// POST /students/:id/reinstate — FR-ENR-010. A suspended student's
/// enrolments are restored as they were; a withdrawn student needs a fresh
/// enrolment decision ([requiresReEnrolment] tells you which case this was).
class ReinstateResult {
  const ReinstateResult({
    required this.studentId,
    required this.status,
    required this.requiresReEnrolment,
    required this.message,
  });

  final String studentId;
  final String status;
  final bool requiresReEnrolment;
  final String message;

  factory ReinstateResult.fromJson(Map<String, dynamic> json) {
    return ReinstateResult(
      studentId: json['studentId'] as String? ?? '',
      status: json['status'] as String? ?? 'ACTIVE',
      requiresReEnrolment: json['requiresReEnrolment'] as bool? ?? false,
      message: json['message'] as String? ?? '',
    );
  }
}

/// One student's outcome inside a bulk operation.
class RowResult {
  const RowResult({
    required this.studentId,
    required this.outcome,
    this.name,
    this.message,
  });

  final String studentId;
  final String? name;
  final String outcome;

  /// Why it failed or was skipped. Absent on success.
  final String? message;

  factory RowResult.fromJson(Map<String, dynamic> json) {
    return RowResult(
      studentId: json['studentId'] as String? ?? '',
      name: json['name'] as String?,
      outcome: json['outcome'] as String? ?? '',
      message: json['message'] as String?,
    );
  }
}

/// A bulk operation's report — NOT all-or-nothing (FR-OPS-020..026). Each
/// row is atomic in itself; the batch is "as many as could be done", and the
/// summary says so in words.
class BatchReport {
  const BatchReport({
    required this.total,
    required this.succeeded,
    required this.failed,
    required this.skipped,
    required this.rows,
    required this.summary,
    this.sectionId,
    this.sectionName,
    this.placesRemaining,
  });

  final int total;
  final int succeeded;
  final int failed;
  final int skipped;

  /// Failures first — the rows needing attention should not sit below fifty
  /// that worked (the server sorts them).
  final List<RowResult> rows;
  final String summary;

  /// Only the transfer preview carries the destination's state after the
  /// batch, so an operator sees what is left.
  final String? sectionId;
  final String? sectionName;
  final int? placesRemaining;

  factory BatchReport.fromJson(Map<String, dynamic> json) {
    final section = json['section'] as Map<String, dynamic>?;
    return BatchReport(
      total: json['total'] as int? ?? 0,
      succeeded: json['succeeded'] as int? ?? 0,
      failed: json['failed'] as int? ?? 0,
      skipped: json['skipped'] as int? ?? 0,
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RowResult.fromJson)
          .toList(),
      summary: json['summary'] as String? ?? '',
      sectionId: section?['id'] as String?,
      sectionName: section?['name'] as String?,
      placesRemaining: section?['placesRemaining'] as int?,
    );
  }
}