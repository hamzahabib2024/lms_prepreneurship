class SectionSubject {
  const SectionSubject({
    required this.sectionSubjectId,
    required this.subjectName,
    required this.subjectCode,
    required this.sectionCode,
  });

  final String sectionSubjectId;
  final String subjectName;
  final String subjectCode;
  final String sectionCode;

  String get label => '$subjectCode $subjectName — $sectionCode';

  factory SectionSubject.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? {};
    final section = json['section'] as Map<String, dynamic>? ?? {};
    return SectionSubject(
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
    );
  }
}
