/// Models for the student learning domain — SRS §13.5, FR-PRG-007.
///
/// My Subjects shows every enrolled subject with progress, outstanding work,
/// and completion status. Subject Detail breaks that down further with
/// modules, lectures and assignment/quiz panels.
library;

class SubjectProgress {
  const SubjectProgress({
    required this.sectionSubjectId,
    required this.subjectId,
    required this.subjectCode,
    required this.subjectName,
    required this.overallPercent,
    this.attendancePercent,
    required this.completionMet,
    required this.outstanding,
  });

  final String sectionSubjectId;
  final String subjectId;
  final String subjectCode;
  final String subjectName;
  final int overallPercent;
  final int? attendancePercent;
  final bool completionMet;
  final List<String> outstanding;

  factory SubjectProgress.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    return SubjectProgress(
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      subjectId: subject['id'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      overallPercent: (json['overallPercent'] as num?)?.toInt() ?? 0,
      attendancePercent: (json['attendancePercent'] as num?)?.toInt(),
      completionMet: json['completionMet'] as bool? ?? false,
      outstanding: (json['outstanding'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
    );
  }
}

class MyProgress {
  const MyProgress({
    required this.overallPercent,
    required this.subjectCount,
    required this.completedCount,
    required this.computedAt,
    required this.subjects,
  });

  final int overallPercent;
  final int subjectCount;
  final int completedCount;
  final String computedAt;
  final List<SubjectProgress> subjects;

  factory MyProgress.fromJson(Map<String, dynamic> json) {
    return MyProgress(
      overallPercent: (json['overallPercent'] as num?)?.toInt() ?? 0,
      subjectCount: (json['subjectCount'] as num?)?.toInt() ?? 0,
      completedCount: (json['completedCount'] as num?)?.toInt() ?? 0,
      computedAt: json['computedAt'] as String? ?? '',
      subjects: (json['subjects'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(SubjectProgress.fromJson)
          .toList(),
    );
  }
}

class ProgressComponent {
  const ProgressComponent({
    required this.key,
    required this.completed,
    required this.total,
    required this.percent,
  });

  final String key;
  final int completed;
  final int total;
  final int percent;

  factory ProgressComponent.fromJson(Map<String, dynamic> json) {
    return ProgressComponent(
      key: json['key'] as String? ?? '',
      completed: (json['completed'] as num?)?.toInt() ?? 0,
      total: (json['total'] as num?)?.toInt() ?? 0,
      percent: (json['percent'] as num?)?.toInt() ?? 0,
    );
  }
}

class CompletionCriteria {
  const CompletionCriteria({required this.met, required this.outstanding});

  final bool met;
  final List<String> outstanding;

  factory CompletionCriteria.fromJson(Map<String, dynamic> json) {
    return CompletionCriteria(
      met: json['met'] as bool? ?? false,
      outstanding: (json['outstanding'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
    );
  }
}

class SubjectDetailProgress {
  const SubjectDetailProgress({
    required this.sectionSubjectId,
    required this.subjectId,
    required this.subjectCode,
    required this.subjectName,
    required this.overallPercent,
    required this.components,
    required this.attendance,
    required this.completionCriteria,
  });

  final String sectionSubjectId;
  final String subjectId;
  final String subjectCode;
  final String subjectName;
  final int overallPercent;
  final List<ProgressComponent> components;
  final AttendanceInfo attendance;
  final CompletionCriteria completionCriteria;

  factory SubjectDetailProgress.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final attendance =
        json['attendance'] as Map<String, dynamic>? ?? const {};
    final completion =
        json['completionCriteria'] as Map<String, dynamic>? ?? const {};
    return SubjectDetailProgress(
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      subjectId: subject['id'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      overallPercent: (json['overallPercent'] as num?)?.toInt() ?? 0,
      components: (json['components'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProgressComponent.fromJson)
          .toList(),
      attendance: AttendanceInfo.fromJson(attendance),
      completionCriteria: CompletionCriteria.fromJson(completion),
    );
  }
}

class AttendanceInfo {
  const AttendanceInfo({this.percentage, required this.sessionsInDenominator});

  final int? percentage;
  final int sessionsInDenominator;

  factory AttendanceInfo.fromJson(Map<String, dynamic> json) {
    return AttendanceInfo(
      percentage: (json['percentage'] as num?)?.toInt(),
      sessionsInDenominator:
          (json['sessionsInDenominator'] as num?)?.toInt() ?? 0,
    );
  }
}

class LearningModule {
  const LearningModule({
    required this.id,
    required this.title,
    this.description,
    required this.lessons,
  });

  final String id;
  final String title;
  final String? description;
  final List<LearningLesson> lessons;

  factory LearningModule.fromJson(Map<String, dynamic> json) {
    return LearningModule(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      lessons: (json['lessons'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LearningLesson.fromJson)
          .toList(),
    );
  }
}

class LearningLesson {
  const LearningLesson({
    required this.id,
    required this.title,
    this.description,
    this.estimatedMinutes,
    required this.lectures,
  });

  final String id;
  final String title;
  final String? description;
  final int? estimatedMinutes;
  final List<LearningLecture> lectures;

  factory LearningLesson.fromJson(Map<String, dynamic> json) {
    return LearningLesson(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      estimatedMinutes: json['estimatedMinutes'] as int?,
      lectures: (json['lectures'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(LearningLecture.fromJson)
          .toList(),
    );
  }
}

class LearningLecture {
  const LearningLecture({
    required this.id,
    required this.title,
    this.durationSeconds,
    required this.recordedOn,
    required this.availabilityStatus,
    this.watch,
  });

  final String id;
  final String title;
  final int? durationSeconds;
  final String recordedOn;
  final String availabilityStatus;
  final WatchState? watch;

  factory LearningLecture.fromJson(Map<String, dynamic> json) {
    final watchData = json['watch'] as Map<String, dynamic>?;
    return LearningLecture(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      durationSeconds: json['durationSeconds'] as int?,
      recordedOn: json['recordedOn'] as String? ?? '',
      availabilityStatus: json['availabilityStatus'] as String? ?? '',
      watch: watchData != null ? WatchState.fromJson(watchData) : null,
    );
  }

  bool get isUnavailable => availabilityStatus != 'AVAILABLE';
  bool get isWatched => watch?.isComplete == true;
  int get watchedPercent => watch?.watchedPercent ?? 0;
  int get resumeAtSeconds => watch?.lastPositionSeconds ?? 0;
}

class WatchState {
  const WatchState({
    required this.watchedPercent,
    required this.lastPositionSeconds,
    required this.isComplete,
  });

  final int watchedPercent;
  final int lastPositionSeconds;
  final bool isComplete;

  factory WatchState.fromJson(Map<String, dynamic> json) {
    return WatchState(
      watchedPercent: (json['watchedPercent'] as num?)?.toInt() ?? 0,
      lastPositionSeconds: (json['lastPositionSeconds'] as num?)?.toInt() ?? 0,
      isComplete: json['isComplete'] as bool? ?? false,
    );
  }
}

class Handout {
  const Handout({
    required this.id,
    required this.title,
    required this.filename,
    required this.sizeBytes,
  });

  final String id;
  final String title;
  final String filename;
  final int sizeBytes;

  factory Handout.fromJson(Map<String, dynamic> json) {
    return Handout(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    );
  }

  String get sizeLabel {
    final kb = (sizeBytes / 1024).ceil();
    return kb < 1024 ? '$kb KB' : '${(kb / 1024).toStringAsFixed(1)} MB';
  }
}
