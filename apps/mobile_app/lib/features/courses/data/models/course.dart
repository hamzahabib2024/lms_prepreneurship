/// A class the caller may see — the index entry for the Courses page.
///
/// Maps `GET /courses`. The server scopes this by role: students see their
/// enrolments, teachers their assigned sections, admins everything.
class Course {
  const Course({
    required this.id,
    required this.subject,
    required this.section,
    this.teachers = const [],
    this.publishedCount = 0,
    this.draftCount = 0,
    this.folderConnected = false,
    this.latestRecordingOn,
    this.canManage = false,
  });

  final String id;
  final CourseSubject subject;
  final CourseSection section;
  final List<String> teachers;
  final int publishedCount;
  final int draftCount;
  final bool folderConnected;
  final String? latestRecordingOn;
  final bool canManage;

  factory Course.fromJson(Map<String, dynamic> json) => Course(
        id: json['id'] as String? ?? '',
        subject: CourseSubject.fromJson(
            json['subject'] as Map<String, dynamic>? ?? const {}),
        section: CourseSection.fromJson(
            json['section'] as Map<String, dynamic>? ?? const {}),
        teachers: (json['teachers'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
        publishedCount: json['publishedCount'] as int? ?? 0,
        draftCount: json['draftCount'] as int? ?? 0,
        folderConnected: json['folderConnected'] as bool? ?? false,
        latestRecordingOn: json['latestRecordingOn'] as String?,
        canManage: json['canManage'] as bool? ?? false,
      );
}

class CourseSubject {
  const CourseSubject({
    required this.id,
    required this.code,
    required this.name,
  });

  final String id;
  final String code;
  final String name;

  factory CourseSubject.fromJson(Map<String, dynamic> json) => CourseSubject(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

class CourseSection {
  const CourseSection({
    required this.id,
    required this.code,
    required this.name,
    this.status,
    this.session,
  });

  final String id;
  final String code;
  final String name;
  final String? status;
  final String? session;

  factory CourseSection.fromJson(Map<String, dynamic> json) => CourseSection(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String?,
        session: json['session'] as String?,
      );
}
