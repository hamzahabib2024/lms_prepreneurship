/// Models for the assignment builder — SRS §13.6, FR-TCH-020.
library;

class AssignmentDraft {
  const AssignmentDraft({
    this.id,
    required this.title,
    required this.sectionSubjectId,
    required this.marksAvailable,
    required this.dueAt,
    required this.latePolicy,
    required this.publicationStatus,
    this.rubricId,
    this.description,
    this.attachments = const [],
  });

  final String? id;
  final String title;
  final String sectionSubjectId;
  final int marksAvailable;
  final String dueAt;
  final String latePolicy;
  final String publicationStatus;
  final String? rubricId;
  final String? description;
  final List<Attachment> attachments;

  Map<String, dynamic> toJson() => {
    if (id != null) 'id': id,
    'title': title,
    'sectionSubjectId': sectionSubjectId,
    'marksAvailable': marksAvailable,
    'dueAt': dueAt,
    'latePolicy': latePolicy,
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
