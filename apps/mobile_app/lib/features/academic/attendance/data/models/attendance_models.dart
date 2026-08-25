/// Models for the attendance domain — SRS §5.11, §13.6, UC-15.
library;

class AttendanceSession {
  const AttendanceSession({
    required this.id,
    required this.title,
    required this.scheduledStart,
    required this.status,
    required this.subjectCode,
    required this.subjectName,
    required this.sectionCode,
    required this.sectionName,
  });

  final String id;
  final String title;
  final String scheduledStart;
  final String status;
  final String subjectCode;
  final String subjectName;
  final String sectionCode;
  final String sectionName;

  factory AttendanceSession.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final section = json['section'] as Map<String, dynamic>? ?? const {};
    return AttendanceSession(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      scheduledStart: json['scheduledStart'] as String? ?? '',
      status: json['status'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
      sectionName: section['name'] as String? ?? '',
    );
  }

  String get label =>
      '$subjectCode · $sectionCode — $title';
}

typedef AttendanceMarkStatus = String; // PRESENT, ABSENT, LATE, EXCUSED, NOT_MARKED

class RegisterStudent {
  const RegisterStudent({
    required this.studentId,
    this.rollNo,
    required this.registrationNo,
    required this.name,
    required this.status,
    required this.markingSource,
    this.participationSeconds,
    this.markedAt,
  });

  final String studentId;
  final int? rollNo;
  final String registrationNo;
  final String name;
  final AttendanceMarkStatus status;
  final String markingSource;
  final int? participationSeconds;
  final String? markedAt;

  factory RegisterStudent.fromJson(Map<String, dynamic> json) {
    return RegisterStudent(
      studentId: json['studentId'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      registrationNo: json['registrationNo'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? 'NOT_MARKED',
      markingSource: json['markingSource'] as String? ?? 'MANUAL',
      participationSeconds: json['participationSeconds'] as int?,
      markedAt: json['markedAt'] as String?,
    );
  }
}

class Register {
  const Register({
    required this.session,
    required this.students,
    required this.summary,
    required this.isComplete,
  });

  final RegisterSession session;
  final List<RegisterStudent> students;
  final Map<String, int> summary;
  final bool isComplete;

  factory Register.fromJson(Map<String, dynamic> json) {
    final sessionData =
        json['session'] as Map<String, dynamic>? ?? const {};
    return Register(
      session: RegisterSession.fromJson(sessionData),
      students: (json['students'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RegisterStudent.fromJson)
          .toList(),
      summary: (json['summary'] as Map<String, dynamic>? ?? const {})
          .map((k, v) => MapEntry(k, (v as num?)?.toInt() ?? 0)),
      isComplete: json['isComplete'] as bool? ?? false,
    );
  }
}

class RegisterSession {
  const RegisterSession({
    required this.id,
    required this.title,
    required this.scheduledStart,
    required this.status,
    required this.subjectCode,
    required this.subjectName,
    required this.sectionCode,
    required this.sectionName,
  });

  final String id;
  final String title;
  final String scheduledStart;
  final String status;
  final String subjectCode;
  final String subjectName;
  final String sectionCode;
  final String sectionName;

  factory RegisterSession.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final section = json['section'] as Map<String, dynamic>? ?? const {};
    return RegisterSession(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      scheduledStart: json['scheduledStart'] as String? ?? '',
      status: json['status'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
      sectionName: section['name'] as String? ?? '',
    );
  }
}

class AttendanceSaveResult {
  const AttendanceSaveResult({required this.summary, required this.thresholdWarningsRaised});

  final Map<String, int> summary;
  final List<dynamic> thresholdWarningsRaised;

  factory AttendanceSaveResult.fromJson(Map<String, dynamic> json) {
    return AttendanceSaveResult(
      summary: (json['summary'] as Map<String, dynamic>? ?? const {})
          .map((k, v) => MapEntry(k, (v as num?)?.toInt() ?? 0)),
      thresholdWarningsRaised:
          json['thresholdWarningsRaised'] as List<dynamic>? ?? const [],
    );
  }
}
