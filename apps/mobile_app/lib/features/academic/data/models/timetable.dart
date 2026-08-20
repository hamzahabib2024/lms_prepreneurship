/// Timetable and teacher-staffing models — SRS §13.12, FR-CRS-021..026.
library;

class TimetableEntry {
  const TimetableEntry({
    required this.id,
    required this.title,
    required this.subject,
    required this.section,
    this.teacher,
    required this.scheduledStart,
    required this.scheduledEnd,
    required this.status,
  });

  final String id;
  final String title;
  final String subject;
  final String section;
  final String? teacher;
  final DateTime scheduledStart;
  final DateTime scheduledEnd;
  final String status;

  factory TimetableEntry.fromJson(Map<String, dynamic> json) => TimetableEntry(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        subject: json['subject'] as String? ?? '',
        section: json['section'] as String? ?? '',
        teacher: json['teacher'] as String?,
        scheduledStart:
            DateTime.tryParse(json['scheduledStart'] as String? ?? '') ?? DateTime.now(),
        scheduledEnd: DateTime.tryParse(json['scheduledEnd'] as String? ?? '') ?? DateTime.now(),
        status: json['status'] as String? ?? '',
      );
}

class TimetableDay {
  const TimetableDay({required this.date, required this.entries});

  /// "2026-08-20" — the day's identity from the server.
  final String date;
  final List<TimetableEntry> entries;

  factory TimetableDay.fromJson(Map<String, dynamic> json) => TimetableDay(
        date: json['date'] as String? ?? '',
        entries: (json['entries'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(TimetableEntry.fromJson)
            .toList(),
      );
}

class Timetable {
  const Timetable({
    required this.days,
    this.nextClass,
    this.message,
  });

  final List<TimetableDay> days;
  final TimetableEntry? nextClass;
  final String? message;

  factory Timetable.fromJson(Map<String, dynamic> json) {
    final next = json['nextClass'];
    return Timetable(
      days: (json['days'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(TimetableDay.fromJson)
          .toList(),
      nextClass:
          next is Map<String, dynamic> ? TimetableEntry.fromJson(next) : null,
      message: json['message'] as String?,
    );
  }
}

/// FR-LIV-031 — preview before generate, so a clash is seen before it exists.
class TimetablePreview {
  const TimetablePreview({required this.count, required this.message});

  final int count;
  final String message;

  factory TimetablePreview.fromJson(Map<String, dynamic> json) => TimetablePreview(
        count: json['count'] as int? ?? 0,
        message: json['message'] as String? ?? '',
      );
}

class TimetableReport {
  const TimetableReport({
    required this.total,
    required this.succeeded,
    required this.failed,
    required this.summary,
  });

  final int total;
  final int succeeded;
  final int failed;
  final String summary;

  factory TimetableReport.fromJson(Map<String, dynamic> json) => TimetableReport(
        total: json['total'] as int? ?? 0,
        succeeded: json['succeeded'] as int? ?? 0,
        failed: json['failed'] as int? ?? 0,
        summary: json['summary'] as String? ?? '',
      );
}

/// FR-CRS-015 — a teacher's current workload, read BEFORE assigning.
class TeacherLoad {
  const TeacherLoad({
    required this.teacherId,
    required this.name,
    required this.status,
    required this.subjectSections,
    required this.students,
  });

  final String teacherId;
  final String name;
  final String status;
  final int subjectSections;
  final int students;

  bool get assignable => status == 'ACTIVE' || status == 'INVITED';

  factory TeacherLoad.fromJson(Map<String, dynamic> json) => TeacherLoad(
        teacherId: json['teacherId'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? '',
        subjectSections: json['subjectSections'] as int? ?? 0,
        students: json['students'] as int? ?? 0,
      );
}

/// One assignment of a teacher to a subject within a section (BR-ACC-04).
class TeacherAssignment {
  const TeacherAssignment({
    required this.id,
    required this.sectionSubjectId,
    required this.assignmentRole,
    required this.startDate,
    this.endDate,
    required this.isLive,
    required this.sectionCode,
    required this.sectionShift,
    required this.subjectCode,
    required this.subjectName,
    required this.enrolled,
  });

  final String id;
  final String sectionSubjectId;
  final String assignmentRole;
  final DateTime startDate;
  final DateTime? endDate;
  final bool isLive;
  final String sectionCode;
  final String sectionShift;
  final String subjectCode;
  final String subjectName;
  final int enrolled;

  factory TeacherAssignment.fromJson(Map<String, dynamic> json) {
    final ss = json['sectionSubject'] as Map<String, dynamic>? ?? const {};
    final section = ss['section'] as Map<String, dynamic>? ?? const {};
    final subject = ss['subject'] as Map<String, dynamic>? ?? const {};
    final count = ss['_count'] as Map<String, dynamic>? ?? const {};
    return TeacherAssignment(
      id: json['id'] as String? ?? '',
      sectionSubjectId: ss['id'] as String? ?? '',
      assignmentRole: json['assignmentRole'] as String? ?? 'PRIMARY',
      startDate: DateTime.tryParse(json['startDate'] as String? ?? '') ?? DateTime.now(),
      endDate: DateTime.tryParse(json['endDate'] as String? ?? ''),
      isLive: json['isLive'] as bool? ?? true,
      sectionCode: section['code'] as String? ?? '',
      sectionShift: section['shift'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      enrolled: count['enrolments'] as int? ?? 0,
    );
  }
}

/// A section-subject for a picker — "SP26-A — DM Digital Marketing".
class OfferingChoice {
  const OfferingChoice({required this.id, required this.label, required this.hasTeacher});

  final String id;
  final String label;
  final bool hasTeacher;
}