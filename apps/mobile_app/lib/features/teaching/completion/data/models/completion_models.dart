/// Models for completion tracking — SRS §13.6, FR-TCH-023.
library;

class CompletionRoster {
  const CompletionRoster({
    required this.sectionSubject,
    required this.summary,
    required this.students,
  });

  final SectionSubjectInfo sectionSubject;
  final CompletionSummary summary;
  final List<CompletionRow> students;

  factory CompletionRoster.fromJson(Map<String, dynamic> json) {
    return CompletionRoster(
      sectionSubject: SectionSubjectInfo.fromJson(
          json['sectionSubject'] as Map<String, dynamic>? ?? const {}),
      summary: CompletionSummary.fromJson(
          json['summary'] as Map<String, dynamic>? ?? const {}),
      students: (json['students'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CompletionRow.fromJson)
          .toList(),
    );
  }
}

class SectionSubjectInfo {
  const SectionSubjectInfo({
    required this.id,
    required this.subject,
    required this.section,
    required this.code,
  });

  final String id;
  final String subject;
  final String section;
  final String code;

  factory SectionSubjectInfo.fromJson(Map<String, dynamic> json) {
    return SectionSubjectInfo(
      id: json['id'] as String? ?? '',
      subject: json['subject'] as String? ?? '',
      section: json['section'] as String? ?? '',
      code: json['code'] as String? ?? '',
    );
  }
}

class CompletionSummary {
  const CompletionSummary({
    required this.enrolled,
    required this.completed,
    required this.notCompleted,
    required this.undecided,
    required this.criteriaMet,
  });

  final int enrolled;
  final int completed;
  final int notCompleted;
  final int undecided;
  final int criteriaMet;

  factory CompletionSummary.fromJson(Map<String, dynamic> json) {
    return CompletionSummary(
      enrolled: (json['enrolled'] as num?)?.toInt() ?? 0,
      completed: (json['completed'] as num?)?.toInt() ?? 0,
      notCompleted: (json['notCompleted'] as num?)?.toInt() ?? 0,
      undecided: (json['undecided'] as num?)?.toInt() ?? 0,
      criteriaMet: (json['criteriaMet'] as num?)?.toInt() ?? 0,
    );
  }
}

class CompletionRow {
  const CompletionRow({
    required this.studentId,
    this.rollNo,
    required this.registrationNo,
    required this.name,
    required this.computedPercent,
    required this.criteriaMet,
    this.outstanding = const [],
    this.attendancePercent,
    required this.decision,
    this.note,
    this.decidedBy,
    this.decidedAt,
    this.wasOverride = false,
  });

  final String studentId;
  final int? rollNo;
  final String registrationNo;
  final String name;
  final num computedPercent;
  final bool criteriaMet;
  final List<String> outstanding;
  final num? attendancePercent;
  final String decision;
  final String? note;
  final String? decidedBy;
  final String? decidedAt;
  final bool wasOverride;

  factory CompletionRow.fromJson(Map<String, dynamic> json) {
    return CompletionRow(
      studentId: json['studentId'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      registrationNo: json['registrationNo'] as String? ?? '',
      name: json['name'] as String? ?? '',
      computedPercent: json['computedPercent'] as num? ?? 0,
      criteriaMet: json['criteriaMet'] as bool? ?? false,
      outstanding: (json['outstanding'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      attendancePercent: json['attendancePercent'] as num?,
      decision: json['decision'] as String? ?? 'IN_PROGRESS',
      note: json['note'] as String?,
      decidedBy: json['decidedBy'] as String?,
      decidedAt: json['decidedAt'] as String?,
      wasOverride: json['wasOverride'] as bool? ?? false,
    );
  }
}
