/// Programme certificate readiness — per-subject breakdown.
///
/// Maps `GET /students/:id/certificates/programme/:pid/standing`.
class ProgrammeStanding {
  const ProgrammeStanding({
    this.eligible = false,
    this.alreadyIssued,
    this.subjects = const [],
    this.message = '',
  });

  final bool eligible;
  final ProgrammeStandingCertificate? alreadyIssued;
  final List<ProgrammeSubjectStanding> subjects;
  final String message;

  factory ProgrammeStanding.fromJson(Map<String, dynamic> json) =>
      ProgrammeStanding(
        eligible: json['eligible'] as bool? ?? false,
        alreadyIssued: json['alreadyIssued'] != null
            ? ProgrammeStandingCertificate.fromJson(
                json['alreadyIssued'] as Map<String, dynamic>)
            : null,
        subjects: (json['subjects'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(ProgrammeSubjectStanding.fromJson)
            .toList(),
        message: json['message'] as String? ?? '',
      );
}

class ProgrammeStandingCertificate {
  const ProgrammeStandingCertificate({
    required this.id,
    required this.certificateNo,
    this.issuedAt = '',
  });

  final String id;
  final String certificateNo;
  final String issuedAt;

  factory ProgrammeStandingCertificate.fromJson(
          Map<String, dynamic> json) =>
      ProgrammeStandingCertificate(
        id: json['id'] as String? ?? '',
        certificateNo: json['certificateNo'] as String? ?? '',
        issuedAt: json['issuedAt'] as String? ?? '',
      );
}

class ProgrammeSubjectStanding {
  const ProgrammeSubjectStanding({
    this.sectionSubjectId = '',
    this.subjectName = '',
    this.met = false,
    this.overallPercent = 0,
    this.outstanding = const [],
  });

  final String sectionSubjectId;
  final String subjectName;
  final bool met;
  final double overallPercent;
  final List<String> outstanding;

  factory ProgrammeSubjectStanding.fromJson(Map<String, dynamic> json) =>
      ProgrammeSubjectStanding(
        sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
        subjectName: json['subjectName'] as String? ?? '',
        met: json['met'] as bool? ?? false,
        overallPercent:
            (json['overallPercent'] as num?)?.toDouble() ?? 0,
        outstanding: (json['outstanding'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}
