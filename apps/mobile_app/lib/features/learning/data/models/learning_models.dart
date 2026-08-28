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

// ------------------------------------------------------------- assignments ---

class StudentAssignment {
  const StudentAssignment({
    required this.id,
    required this.title,
    required this.instructions,
    this.hasBriefAudio = false,
    this.briefAudioSeconds,
    this.attachmentCount = 0,
    required this.marksAvailable,
    required this.dueAt,
    this.extendedTo,
    required this.submissionType,
    required this.allowedFileTypes,
    required this.maxFileSizeMb,
    required this.maxFileCount,
    required this.resubmissionPolicy,
    required this.latePolicy,
    required this.isOpen,
    required this.isOverdue,
    required this.submitted,
    this.submittedAt,
    this.version = 1,
    this.wasLate = false,
    this.fileCount = 0,
    this.submissionId,
    this.commentCount = 0,
    this.hasFeedbackAudio = false,
    this.feedbackAudioSeconds,
    this.grade,
  });

  final String id;
  final String title;
  final String instructions;
  final bool hasBriefAudio;
  final int? briefAudioSeconds;
  final int attachmentCount;
  final int marksAvailable;
  final DateTime dueAt;
  final DateTime? extendedTo;
  final String submissionType;
  final List<String> allowedFileTypes;
  final int maxFileSizeMb;
  final int maxFileCount;
  final String resubmissionPolicy;
  final String latePolicy;
  final bool isOpen;
  final bool isOverdue;
  final bool submitted;
  final DateTime? submittedAt;
  final int version;
  final bool wasLate;
  final int fileCount;
  final String? submissionId;
  final int commentCount;
  final bool hasFeedbackAudio;
  final int? feedbackAudioSeconds;
  final AssignmentGrade? grade;

  factory StudentAssignment.fromJson(Map<String, dynamic> json) {
    final gradeData = json['grade'] as Map<String, dynamic>?;
    return StudentAssignment(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      instructions: json['instructions'] as String? ?? '',
      hasBriefAudio: json['hasBriefAudio'] as bool? ?? false,
      briefAudioSeconds: json['briefAudioSeconds'] as int?,
      attachmentCount: json['attachmentCount'] as int? ?? 0,
      marksAvailable: json['marksAvailable'] as int? ?? 0,
      dueAt: DateTime.tryParse(json['dueAt'] as String? ?? '') ?? DateTime.now(),
      extendedTo: DateTime.tryParse(json['extendedTo'] as String? ?? ''),
      submissionType: json['submissionType'] as String? ?? 'FILE',
      allowedFileTypes: (json['allowedFileTypes'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      maxFileSizeMb: json['maxFileSizeMb'] as int? ?? 10,
      maxFileCount: json['maxFileCount'] as int? ?? 5,
      resubmissionPolicy: json['resubmissionPolicy'] as String? ?? 'NONE',
      latePolicy: json['latePolicy'] as String? ?? '',
      isOpen: json['isOpen'] as bool? ?? false,
      isOverdue: json['isOverdue'] as bool? ?? false,
      submitted: json['submitted'] as bool? ?? false,
      submittedAt: DateTime.tryParse(json['submittedAt'] as String? ?? ''),
      version: json['version'] as int? ?? 1,
      wasLate: json['wasLate'] as bool? ?? false,
      fileCount: json['fileCount'] as int? ?? 0,
      submissionId: json['submissionId'] as String?,
      commentCount: json['commentCount'] as int? ?? 0,
      hasFeedbackAudio: json['hasFeedbackAudio'] as bool? ?? false,
      feedbackAudioSeconds: json['feedbackAudioSeconds'] as int?,
      grade: gradeData != null ? AssignmentGrade.fromJson(gradeData) : null,
    );
  }

  String get deadlineText {
    final due = extendedTo ?? dueAt;
    final days = due.difference(DateTime.now()).inDays;
    if (submitted && submittedAt != null) {
      final d = submittedAt!;
      return 'Submitted ${d.day}/${d.month}/${d.year}${version > 1 ? ' · version $version' : ''}';
    }
    if (days < 0) return '${-days} day${days == -1 ? '' : 's'} overdue';
    if (days == 0) return 'Due today';
    return 'Due in $days day${days == 1 ? '' : 's'}';
  }

  bool get canSubmit =>
      isOpen && (!submitted || resubmissionPolicy != 'NONE');
}

class AssignmentGrade {
  const AssignmentGrade({
    required this.status,
    this.finalMarks,
    this.penaltyApplied,
    this.feedback,
  });

  final String status;
  final int? finalMarks;
  final int? penaltyApplied;
  final String? feedback;

  factory AssignmentGrade.fromJson(Map<String, dynamic> json) => AssignmentGrade(
        status: json['status'] as String? ?? 'AWAITING_GRADE',
        finalMarks: json['finalMarks'] as int?,
        penaltyApplied: json['penaltyApplied'] as int?,
        feedback: json['feedback'] as String?,
      );
}

class PendingFile {
  const PendingFile({
    required this.id,
    required this.filename,
    required this.sizeBytes,
    required this.scanStatus,
  });

  final String id;
  final String filename;
  final int sizeBytes;
  final String scanStatus;

  factory PendingFile.fromJson(Map<String, dynamic> json) => PendingFile(
        id: json['id'] as String? ?? '',
        filename: json['filename'] as String? ?? '',
        sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
        scanStatus: json['scanStatus'] as String? ?? 'PENDING',
      );

  String get sizeLabel {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) return '${(sizeBytes / 1024).round()} KB';
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class SubmissionResult {
  const SubmissionResult({this.isLate = false, this.version = 1});

  final bool isLate;
  final int version;

  factory SubmissionResult.fromJson(Map<String, dynamic> json) => SubmissionResult(
        isLate: json['isLate'] as bool? ?? false,
        version: json['version'] as int? ?? 1,
      );
}
