/// The Institute's certificate register — SRS §9.10, FR-CRT.
///
/// Distinct from [Certificate] beside it, which is a student's own award.
/// This is every certificate the Institute has issued, and it reads the
/// SNAPSHOT fields rather than live joins: renaming a subject must not
/// rewrite a document somebody was handed last year.
library;

class RegisterEntry {
  const RegisterEntry({
    required this.id,
    required this.certificateNo,
    required this.type,
    required this.kind,
    required this.status,
    required this.issuedAt,
    required this.completionDate,
    required this.studentName,
    required this.registrationNo,
    required this.rollNo,
    required this.awardTitle,
    required this.programme,
    required this.verificationCode,
    required this.revocationReason,
    required this.issuedManually,
  });

  final String id;
  final String certificateNo;

  /// SUBJECT or PROGRAMME.
  final String type;
  final String kind;

  /// ISSUED, REVOKED or ARCHIVED.
  final String status;
  final DateTime issuedAt;
  final DateTime? completionDate;

  final String studentName;
  final String? registrationNo;
  final int? rollNo;

  final String awardTitle;
  final String? programme;

  final String verificationCode;
  final String? revocationReason;

  /// Issued by hand rather than after a requirements check. Worth showing:
  /// nothing but the issuer's judgement stands behind it.
  final bool issuedManually;

  bool get isRevoked => status == 'REVOKED';

  /// "Reg 2024-118 · Roll 12", omitting whichever the student has not got.
  String get studentIdentity {
    final parts = <String>[
      if (registrationNo != null && registrationNo!.isNotEmpty)
        'Reg $registrationNo',
      if (rollNo != null) 'Roll $rollNo',
    ];
    return parts.join(' · ');
  }

  factory RegisterEntry.fromJson(Map<String, dynamic> json) {
    final student = (json['student'] as Map<String, dynamic>?) ?? const {};
    final award = (json['award'] as Map<String, dynamic>?) ?? const {};
    final completion = json['completionDate'] as String?;
    return RegisterEntry(
      id: json['id'] as String,
      certificateNo: json['certificateNo'] as String? ?? '',
      type: json['type'] as String? ?? 'SUBJECT',
      kind: json['kind'] as String? ?? '',
      status: json['status'] as String? ?? 'ISSUED',
      issuedAt: DateTime.parse(json['issuedAt'] as String).toLocal(),
      completionDate:
          completion == null ? null : DateTime.tryParse(completion)?.toLocal(),
      studentName: student['name'] as String? ?? 'Unknown student',
      registrationNo: student['registrationNo'] as String?,
      rollNo: student['rollNo'] as int?,
      awardTitle: award['title'] as String? ?? '',
      programme: award['programme'] as String?,
      verificationCode: json['verificationCode'] as String? ?? '',
      revocationReason: json['revocationReason'] as String?,
      issuedManually: json['issuedManually'] as bool? ?? false,
    );
  }
}

/// The four figures at the head of the register.
class RegisterSummary {
  const RegisterSummary({
    required this.total,
    required this.valid,
    required this.revoked,
    required this.archived,
    required this.thisMonth,
  });

  final int total;
  final int valid;
  final int revoked;
  final int archived;
  final int thisMonth;

  factory RegisterSummary.fromJson(Map<String, dynamic> json) {
    return RegisterSummary(
      total: json['total'] as int? ?? 0,
      valid: json['valid'] as int? ?? 0,
      revoked: json['revoked'] as int? ?? 0,
      archived: json['archived'] as int? ?? 0,
      thisMonth: json['thisMonth'] as int? ?? 0,
    );
  }
}

/// One result from the name-and-number search a manual certificate attaches
/// to. Guarded by the issuing permission on the server: it searches the whole
/// roll, which is not something a student or a teacher needs.
class StudentLookupResult {
  const StudentLookupResult({
    required this.id,
    required this.name,
    required this.registrationNo,
    required this.rollNo,
  });

  final String id;
  final String name;
  final String? registrationNo;
  final int? rollNo;

  factory StudentLookupResult.fromJson(Map<String, dynamic> json) {
    return StudentLookupResult(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Unknown student',
      registrationNo: json['registrationNo'] as String?,
      rollNo: json['rollNo'] as int?,
    );
  }
}

/// A page of the register, with the paging block the envelope carries.
class RegisterPage {
  const RegisterPage({
    required this.entries,
    required this.page,
    required this.totalPages,
    required this.totalItems,
    required this.hasNext,
  });

  final List<RegisterEntry> entries;
  final int page;
  final int totalPages;
  final int totalItems;
  final bool hasNext;

  factory RegisterPage.fromEnvelope(Map<String, dynamic> envelope) {
    final data = envelope['data'];
    final pagination =
        (envelope['pagination'] as Map<String, dynamic>?) ?? const {};
    return RegisterPage(
      entries: (data as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RegisterEntry.fromJson)
          .toList(),
      page: pagination['page'] as int? ?? 1,
      totalPages: pagination['totalPages'] as int? ?? 1,
      totalItems: pagination['totalItems'] as int? ?? 0,
      hasNext: pagination['hasNext'] as bool? ?? false,
    );
  }
}
