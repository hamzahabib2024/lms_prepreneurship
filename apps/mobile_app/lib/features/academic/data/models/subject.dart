/// Subjects and the content tree — SRS §13.6, FR-CRS-027..032.
///
/// A subject is created once, without a deployment (FR-CRS-015); a module
/// holds lessons, lessons hold lectures, and every level starts as a draft
/// (BR-CNT-01) that must be published before students see it.
library;

class Subject {
  const Subject({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.credits,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final int? credits;

  factory Subject.fromJson(Map<String, dynamic> json) => Subject(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        description: json['description'] as String?,
        credits: json['credits'] as int?,
      );
}

class Lecture {
  const Lecture({
    required this.id,
    required this.title,
    this.durationSeconds,
    required this.publicationStatus,
    required this.availabilityStatus,
  });

  final String id;
  final String title;
  final int? durationSeconds;
  final String publicationStatus;
  final String availabilityStatus;

  factory Lecture.fromJson(Map<String, dynamic> json) => Lecture(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        durationSeconds: json['durationSeconds'] as int?,
        publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
        availabilityStatus: json['availabilityStatus'] as String? ?? '',
      );
}

class Lesson {
  const Lesson({
    required this.id,
    required this.title,
    this.estimatedMinutes,
    required this.publicationStatus,
    required this.lectures,
  });

  final String id;
  final String title;
  final int? estimatedMinutes;
  final String publicationStatus;
  final List<Lecture> lectures;

  factory Lesson.fromJson(Map<String, dynamic> json) => Lesson(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        estimatedMinutes: json['estimatedMinutes'] as int?,
        publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
        lectures: (json['lectures'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(Lecture.fromJson)
            .toList(),
      );
}

class Module {
  const Module({
    required this.id,
    required this.title,
    this.description,
    required this.publicationStatus,
    required this.lessons,
  });

  final String id;
  final String title;
  final String? description;
  final String publicationStatus;
  final List<Lesson> lessons;

  factory Module.fromJson(Map<String, dynamic> json) => Module(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        description: json['description'] as String?,
        publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
        lessons: (json['lessons'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(Lesson.fromJson)
            .toList(),
      );
}