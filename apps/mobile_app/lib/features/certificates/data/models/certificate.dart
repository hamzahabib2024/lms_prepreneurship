/// A certificate issued to a student — either for a subject or a programme.
///
/// Maps `GET /me/certificates`, `GET /students/:id/certificates`.
/// The certificate is a SNAPSHOT of progress at issuance; it never changes
/// meaning after being issued (FR-CRT-003).
class Certificate {
  const Certificate({
    required this.id,
    required this.certificateNo,
    required this.type,
    required this.status,
    this.progressPercent = 0,
    this.attendancePercent,
    this.averageGradePercent,
    this.criteriaApplied,
    this.issuedAt = '',
    this.issuedBy,
    this.revokedAt,
    this.revokedBy,
    this.revocationReason,
    this.verificationCode = '',
    this.studentId = '',
    this.sectionSubjectId,
    this.programmeId,
    this.subject,
    this.programme,
  });

  final String id;
  final String certificateNo;
  final String type; // SUBJECT or PROGRAMME
  final String status; // ISSUED or REVOKED
  final double progressPercent;
  final double? attendancePercent;
  final double? averageGradePercent;
  final Map<String, dynamic>? criteriaApplied;
  final String issuedAt;
  final String? issuedBy;
  final String? revokedAt;
  final String? revokedBy;
  final String? revocationReason;
  final String verificationCode;
  final String studentId;
  final String? sectionSubjectId;
  final String? programmeId;
  final CertificateSubject? subject;
  final CertificateProgramme? programme;

  bool get isIssued => status == 'ISSUED';
  bool get isRevoked => status == 'REVOKED';
  bool get isSubject => type == 'SUBJECT';
  bool get isProgramme => type == 'PROGRAMME';

  String get awardedFor {
    if (isSubject && subject != null) {
      return '${subject!.code} — ${subject!.name}';
    }
    if (isProgramme && programme != null) {
      return programme!.name;
    }
    return type;
  }

  factory Certificate.fromJson(Map<String, dynamic> json) => Certificate(
        id: json['id'] as String? ?? '',
        certificateNo: json['certificateNo'] as String? ?? '',
        type: json['type'] as String? ?? 'SUBJECT',
        status: json['status'] as String? ?? 'ISSUED',
        progressPercent:
            (json['progressPercent'] as num?)?.toDouble() ?? 0,
        attendancePercent:
            (json['attendancePercent'] as num?)?.toDouble(),
        averageGradePercent:
            (json['averageGradePercent'] as num?)?.toDouble(),
        criteriaApplied: json['criteriaApplied'] is Map<String, dynamic>
            ? json['criteriaApplied'] as Map<String, dynamic>
            : null,
        issuedAt: json['issuedAt'] as String? ?? '',
        issuedBy: json['issuedBy'] as String?,
        revokedAt: json['revokedAt'] as String?,
        revokedBy: json['revokedBy'] as String?,
        revocationReason: json['revocationReason'] as String?,
        verificationCode: json['verificationCode'] as String? ?? '',
        studentId: json['studentId'] as String? ?? '',
        sectionSubjectId: json['sectionSubjectId'] as String?,
        programmeId: json['programmeId'] as String?,
        subject: json['subject'] != null
            ? CertificateSubject.fromJson(
                json['subject'] as Map<String, dynamic>)
            : null,
        programme: json['programme'] != null
            ? CertificateProgramme.fromJson(
                json['programme'] as Map<String, dynamic>)
            : null,
      );
}

class CertificateSubject {
  const CertificateSubject({
    this.id = '',
    this.code = '',
    this.name = '',
  });

  final String id;
  final String code;
  final String name;

  factory CertificateSubject.fromJson(Map<String, dynamic> json) =>
      CertificateSubject(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

class CertificateProgramme {
  const CertificateProgramme({
    this.id = '',
    this.name = '',
    this.code = '',
  });

  final String id;
  final String name;
  final String code;

  factory CertificateProgramme.fromJson(Map<String, dynamic> json) =>
      CertificateProgramme(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        code: json['code'] as String? ?? '',
      );
}
