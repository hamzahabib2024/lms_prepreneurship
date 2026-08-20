/// Sections and their subject offerings — SRS §13.11, FR-CRS-008..016.
library;

class Section {
  const Section({
    required this.id,
    required this.code,
    required this.name,
    required this.capacity,
    required this.enrolledCount,
    required this.placesRemaining,
    required this.isFull,
    required this.shift,
    required this.genderRestriction,
    required this.deliveryMode,
    required this.status,
    this.batchCode,
    this.sessionCode,
    required this.subjectCount,
  });

  final String id;
  final String code;
  final String name;
  final int capacity;
  final int enrolledCount;
  final int placesRemaining;
  final bool isFull;
  final String shift;
  final String genderRestriction;
  final String deliveryMode;
  final String status;

  /// "SP26 · Morning intake" — where the section sits in the hierarchy.
  final String? batchCode;
  final String? sessionCode;
  final int subjectCount;

  factory Section.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>? ?? const {};
    final batch = json['batch'] as Map<String, dynamic>?;
    final session = batch?['academicSession'] as Map<String, dynamic>?;
    return Section(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      capacity: json['capacity'] as int? ?? 0,
      enrolledCount: json['enrolledCount'] as int? ?? 0,
      placesRemaining: json['placesRemaining'] as int? ?? 0,
      isFull: json['isFull'] as bool? ?? false,
      shift: json['shift'] as String? ?? '',
      genderRestriction: json['genderRestriction'] as String? ?? 'MIXED',
      deliveryMode: json['deliveryMode'] as String? ?? '',
      status: json['status'] as String? ?? '',
      batchCode: batch?['name'] as String?,
      sessionCode: session?['code'] as String?,
      subjectCount: count['sectionSubjects'] as int? ?? 0,
    );
  }
}

/// One subject offered to a section — FR-CRS-016/026.
class Offering {
  const Offering({
    required this.id,
    required this.isCompulsory,
    required this.status,
    required this.subjectId,
    required this.subjectCode,
    required this.subjectName,
    required this.teacherNames,
    required this.hasTeacher,
    required this.needsTeacher,
    required this.enrolled,
  });

  final String id;
  final bool isCompulsory;
  final String status;
  final String subjectId;
  final String subjectCode;
  final String subjectName;
  final List<String> teacherNames;
  final bool hasTeacher;
  final bool needsTeacher;
  final int enrolled;

  factory Offering.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final count = json['_count'] as Map<String, dynamic>? ?? const {};
    final assignments = json['assignments'] as List<dynamic>? ?? const [];
    final teachers = <String>[];
    for (final a in assignments.whereType<Map<String, dynamic>>()) {
      final teacher = a['teacher'] as Map<String, dynamic>?;
      final user = teacher?['user'] as Map<String, dynamic>?;
      final name = user?['fullName'] as String?;
      if (name != null && name.isNotEmpty) teachers.add(name);
    }
    return Offering(
      id: json['id'] as String? ?? '',
      isCompulsory: json['isCompulsory'] as bool? ?? false,
      status: json['status'] as String? ?? '',
      subjectId: subject['id'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      teacherNames: teachers,
      hasTeacher: json['hasTeacher'] as bool? ?? false,
      needsTeacher: json['needsTeacher'] as bool? ?? false,
      enrolled: count['enrolments'] as int? ?? 0,
    );
  }
}