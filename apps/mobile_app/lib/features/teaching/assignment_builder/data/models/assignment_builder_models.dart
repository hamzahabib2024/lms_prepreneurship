/// Models for the assignment builder — SRS §13.6, FR-TCH-020.
library;

class AssignmentDraft {
  const AssignmentDraft({
    this.id,
    required this.title,
    required this.sectionSubjectId,
    required this.marksAvailable,
    this.opensAt,
    required this.dueAt,
    this.hardCloseAt,
    required this.latePolicy,
    this.latePenaltyValue,
    this.latePenaltyFloor,
    this.submissionType = 'FILE',
    this.allowedFileTypes = const ['pdf'],
    this.maxFileSizeMb = 10,
    this.maxFileCount = 3,
    this.resubmissionPolicy = 'NONE',
    this.maxAttempts,
    this.graceMinutes = 0,
    required this.publicationStatus,
    this.rubricId,
    this.description,
    this.attachments = const [],
  });

  final String? id;
  final String title;
  final String sectionSubjectId;
  final int marksAvailable;
  final String? opensAt;
  final String dueAt;
  final String? hardCloseAt;
  final String latePolicy;
  final num? latePenaltyValue;
  final num? latePenaltyFloor;
  final String submissionType;
  final List<String> allowedFileTypes;
  final int maxFileSizeMb;
  final int maxFileCount;
  final String resubmissionPolicy;
  final int? maxAttempts;
  final int graceMinutes;
  final String publicationStatus;
  final String? rubricId;
  final String? description;
  final List<Attachment> attachments;

  Map<String, dynamic> toJson() => {
    if (id != null) 'id': id,
    'title': title,
    'sectionSubjectId': sectionSubjectId,
    'marksAvailable': marksAvailable,
    if (opensAt != null) 'opensAt': opensAt,
    'dueAt': dueAt,
    if (hardCloseAt != null) 'hardCloseAt': hardCloseAt,
    'latePolicy': latePolicy,
    if (latePenaltyValue != null) 'latePenaltyValue': latePenaltyValue,
    if (latePenaltyFloor != null) 'latePenaltyFloor': latePenaltyFloor,
    'submissionType': submissionType,
    'allowedFileTypes': allowedFileTypes,
    'maxFileSizeMb': maxFileSizeMb,
    'maxFileCount': maxFileCount,
    'resubmissionPolicy': resubmissionPolicy,
    if (maxAttempts != null) 'maxAttempts': maxAttempts,
    'graceMinutes': graceMinutes,
    'publicationStatus': publicationStatus,
    if (rubricId != null) 'rubricId': rubricId,
    if (description != null) 'description': description,
    'attachments': attachments.map((a) => a.toJson()).toList(),
  };
}

class Attachment {
  const Attachment({
    required this.filename,
    required this.fileBytes,
  });

  final String filename;
  final List<int> fileBytes;

  Map<String, dynamic> toJson() => {
    'filename': filename,
  };
}

class SectionSubject {
  const SectionSubject({
    required this.id,
    required this.subjectCode,
    required this.subjectName,
    required this.sectionCode,
  });

  final String id;
  final String subjectCode;
  final String subjectName;
  final String sectionCode;

  factory SectionSubject.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final section = json['section'] as Map<String, dynamic>? ?? const {};
    return SectionSubject(
      id: json['id'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
    );
  }
}

class AssignmentTemplate {
  const AssignmentTemplate({
    required this.id,
    required this.title,
    required this.marksAvailable,
    required this.dueAt,
    required this.latePolicy,
    required this.publicationStatus,
    this.description,
  });

  final String id;
  final String title;
  final int marksAvailable;
  final String dueAt;
  final String latePolicy;
  final String publicationStatus;
  final String? description;

  factory AssignmentTemplate.fromJson(Map<String, dynamic> json) {
    return AssignmentTemplate(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      marksAvailable: (json['marksAvailable'] as num?)?.toInt() ?? 0,
      dueAt: json['dueAt'] as String? ?? '',
      latePolicy: json['latePolicy'] as String? ?? 'FLAG_ONLY',
      publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
      description: json['description'] as String?,
    );
  }
}

class RubricSummary {
  const RubricSummary({
    required this.id,
    required this.name,
    this.totalMarks,
    this.criteriaCount,
  });

  final String id;
  final String name;
  final int? totalMarks;
  final int? criteriaCount;

  factory RubricSummary.fromJson(Map<String, dynamic> json) {
    return RubricSummary(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? json['title'] as String? ?? '',
      totalMarks: (json['totalMarks'] as num?)?.toInt(),
      criteriaCount: (json['criteriaCount'] as num?)?.toInt(),
    );
  }
}
