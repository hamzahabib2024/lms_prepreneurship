/// Starting a class on the spot — SRS §9.7, FR-LIV.
library;

/// One subject-section this teacher is assigned to, from GET /me/teaching.
///
/// This is the picker behind "start now" and nothing else: it answers "what
/// could you open a room for", which is the one question the teacher cannot
/// be guessed at.
class TeachingAssignment {
  const TeachingAssignment({
    required this.sectionSubjectId,
    required this.subjectName,
    required this.subjectCode,
    required this.sectionCode,
    required this.sectionName,
  });

  final String sectionSubjectId;
  final String subjectName;
  final String subjectCode;
  final String sectionCode;
  final String sectionName;

  String get label => '$subjectName · $sectionCode';

  factory TeachingAssignment.fromJson(Map<String, dynamic> json) {
    final subject = (json['subject'] as Map<String, dynamic>?) ?? const {};
    final section = (json['section'] as Map<String, dynamic>?) ?? const {};
    return TeachingAssignment(
      sectionSubjectId: json['sectionSubjectId'] as String,
      subjectName: subject['name'] as String? ?? 'Subject',
      subjectCode: subject['code'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
      sectionName: section['name'] as String? ?? '',
    );
  }
}

/// The session that was opened. Only the id matters to the caller — it goes
/// straight into the class page, which owns everything else about a class.
class StartedClass {
  const StartedClass({required this.id, required this.title});

  final String id;
  final String? title;

  factory StartedClass.fromJson(Map<String, dynamic> json) {
    return StartedClass(
      id: json['id'] as String,
      title: json['title'] as String?,
    );
  }
}

/// A live provider and whether it is answering — GET /live-providers,
/// FR-SAD-008.
///
/// The Institute may change provider between terms; nothing here names one.
/// `kind` is what the join route will contain, and the client branches on
/// that alone (ARC-025).
class LiveProvider {
  const LiveProvider({
    required this.id,
    required this.name,
    required this.kind,
    required this.isDefault,
    required this.healthy,
    required this.detail,
  });

  final String id;
  final String name;
  final String kind;
  final bool isDefault;

  /// Null when the health of this provider has not been established, which is
  /// not the same as unhealthy and must not be shown as a failure.
  final bool? healthy;
  final String? detail;

  factory LiveProvider.fromJson(Map<String, dynamic> json) {
    final health = json['health'];
    final healthMap = health is Map<String, dynamic> ? health : const {};
    return LiveProvider(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? json['kind'] as String? ?? 'Provider',
      kind: json['kind'] as String? ?? '',
      isDefault: json['isDefault'] as bool? ?? false,
      healthy: (healthMap['healthy'] ?? json['healthy']) as bool?,
      detail: (healthMap['detail'] ?? json['detail']) as String?,
    );
  }
}
