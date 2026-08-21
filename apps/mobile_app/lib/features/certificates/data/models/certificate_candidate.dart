/// A student candidate in the certificate issuance worklist.
///
/// Maps `GET /section-subjects/:id/certificates`. Each candidate shows
/// the student's progress, eligibility, and existing certificate status.
class CertificateCandidate {
  const CertificateCandidate({
    required this.studentId,
    this.registrationNo = '',
    this.rollNo,
    this.name = '',
    this.sectionName = '',
    this.progressPercent = 0,
    this.attendancePercent,
    this.averageGradePercent,
    this.completionMet = false,
    this.outstanding = const [],
    this.certificate,
  });

  final String studentId;
  final String registrationNo;
  final int? rollNo;
  final String name;
  final String sectionName;
  final double progressPercent;
  final double? attendancePercent;
  final double? averageGradePercent;
  final bool completionMet;
  final List<String> outstanding;
  final CandidateCertificate? certificate;

  bool get hasIssuedCertificate =>
      certificate != null && certificate!.status == 'ISSUED';
  bool get hasRevokedCertificate =>
      certificate != null && certificate!.status == 'REVOKED';
  bool get canIssue => completionMet && !hasIssuedCertificate;

  factory CertificateCandidate.fromJson(Map<String, dynamic> json) =>
      CertificateCandidate(
        studentId: json['studentId'] as String? ?? '',
        registrationNo: json['registrationNo'] as String? ?? '',
        rollNo: json['rollNo'] as int?,
        name: json['name'] as String? ?? '',
        sectionName: json['sectionName'] as String? ?? '',
        progressPercent:
            (json['progressPercent'] as num?)?.toDouble() ?? 0,
        attendancePercent:
            (json['attendancePercent'] as num?)?.toDouble(),
        averageGradePercent:
            (json['averageGradePercent'] as num?)?.toDouble(),
        completionMet: json['completionMet'] as bool? ?? false,
        outstanding: (json['outstanding'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
        certificate: json['certificate'] != null
            ? CandidateCertificate.fromJson(
                json['certificate'] as Map<String, dynamic>)
            : null,
      );
}

class CandidateCertificate {
  const CandidateCertificate({
    required this.id,
    required this.certificateNo,
    required this.status,
    this.issuedAt = '',
    this.revokedAt,
    this.revocationReason,
  });

  final String id;
  final String certificateNo;
  final String status;
  final String issuedAt;
  final String? revokedAt;
  final String? revocationReason;

  factory CandidateCertificate.fromJson(Map<String, dynamic> json) =>
      CandidateCertificate(
        id: json['id'] as String? ?? '',
        certificateNo: json['certificateNo'] as String? ?? '',
        status: json['status'] as String? ?? 'ISSUED',
        issuedAt: json['issuedAt'] as String? ?? '',
        revokedAt: json['revokedAt'] as String?,
        revocationReason: json['revocationReason'] as String?,
      );
}
