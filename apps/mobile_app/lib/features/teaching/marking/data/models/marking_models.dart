/// Models for the marking domain — SRS §13.6, FR-TCH-018/019.
library;

// ------------------------------------------------------------------ Marking Queue

class TeacherSection {
  const TeacherSection({
    required this.sectionSubjectId,
    required this.subjectCode,
    required this.subjectName,
    required this.sectionCode,
    required this.enrolled,
  });

  final String sectionSubjectId;
  final String subjectCode;
  final String subjectName;
  final String sectionCode;
  final int enrolled;

  factory TeacherSection.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>? ?? const {};
    final section = json['section'] as Map<String, dynamic>? ?? const {};
    return TeacherSection(
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      subjectCode: subject['code'] as String? ?? '',
      subjectName: subject['name'] as String? ?? '',
      sectionCode: section['code'] as String? ?? '',
      enrolled: (json['enrolled'] as num?)?.toInt() ?? 0,
    );
  }
}

class TeacherAssignment {
  const TeacherAssignment({
    required this.id,
    required this.title,
    required this.dueAt,
    required this.marksAvailable,
    required this.publicationStatus,
    required this.gradesReleased,
    required this.submittedCount,
    required this.gradedCount,
    required this.ungradedCount,
  });

  final String id;
  final String title;
  final String dueAt;
  final int marksAvailable;
  final String publicationStatus;
  final bool gradesReleased;
  final int submittedCount;
  final int gradedCount;
  final int ungradedCount;

  factory TeacherAssignment.fromJson(Map<String, dynamic> json) {
    return TeacherAssignment(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      dueAt: json['dueAt'] as String? ?? '',
      marksAvailable: (json['marksAvailable'] as num?)?.toInt() ?? 0,
      publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
      gradesReleased: json['gradesReleased'] as bool? ?? false,
      submittedCount: (json['submittedCount'] as num?)?.toInt() ?? 0,
      gradedCount: (json['gradedCount'] as num?)?.toInt() ?? 0,
      ungradedCount: (json['ungradedCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class TeacherQuiz {
  const TeacherQuiz({
    required this.id,
    required this.title,
    required this.closesAt,
    required this.totalMarks,
    required this.publicationStatus,
    required this.attemptCount,
    required this.awaitingMarking,
    required this.unreleased,
  });

  final String id;
  final String title;
  final String closesAt;
  final int totalMarks;
  final String publicationStatus;
  final int attemptCount;
  final int awaitingMarking;
  final int unreleased;

  factory TeacherQuiz.fromJson(Map<String, dynamic> json) {
    return TeacherQuiz(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      closesAt: json['closesAt'] as String? ?? '',
      totalMarks: (json['totalMarks'] as num?)?.toInt() ?? 0,
      publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
      attemptCount: (json['attemptCount'] as num?)?.toInt() ?? 0,
      awaitingMarking: (json['awaitingMarking'] as num?)?.toInt() ?? 0,
      unreleased: (json['unreleased'] as num?)?.toInt() ?? 0,
    );
  }
}

// ------------------------------------------------------------------ Grading

class RosterStudent {
  const RosterStudent({
    required this.studentId,
    this.rollNo,
    required this.name,
    this.submissionId,
    required this.submitted,
    this.submittedAt,
    required this.isLate,
    this.minutesLate = 0,
    this.version = 1,
    this.textResponse,
    this.files = const [],
    required this.graded,
    this.rawMarks,
    this.penaltyApplied,
    this.finalMarks,
    this.feedback,
    this.internalNotes,
    this.releasedAt,
  });

  final String studentId;
  final int? rollNo;
  final String name;
  final String? submissionId;
  final bool submitted;
  final String? submittedAt;
  final bool isLate;
  final int minutesLate;
  final int version;
  final String? textResponse;
  final List<SubmissionFile> files;
  final bool graded;
  final num? rawMarks;
  final num? penaltyApplied;
  final num? finalMarks;
  final String? feedback;
  final String? internalNotes;
  final String? releasedAt;

  factory RosterStudent.fromJson(Map<String, dynamic> json) {
    return RosterStudent(
      studentId: json['studentId'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      name: json['name'] as String? ?? '',
      submissionId: json['submissionId'] as String?,
      submitted: json['submitted'] as bool? ?? false,
      submittedAt: json['submittedAt'] as String?,
      isLate: json['isLate'] as bool? ?? false,
      minutesLate: (json['minutesLate'] as num?)?.toInt() ?? 0,
      version: (json['version'] as num?)?.toInt() ?? 1,
      textResponse: json['textResponse'] as String?,
      files: (json['files'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(SubmissionFile.fromJson)
          .toList(),
      graded: json['graded'] as bool? ?? false,
      rawMarks: json['rawMarks'] as num?,
      penaltyApplied: json['penaltyApplied'] as num?,
      finalMarks: json['finalMarks'] as num?,
      feedback: json['feedback'] as String?,
      internalNotes: json['internalNotes'] as String?,
      releasedAt: json['releasedAt'] as String?,
    );
  }
}

class SubmissionFile {
  const SubmissionFile({required this.id, required this.filename});

  final String id;
  final String filename;

  factory SubmissionFile.fromJson(Map<String, dynamic> json) {
    return SubmissionFile(
      id: json['id'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
    );
  }
}

class GradingRoster {
  const GradingRoster({
    required this.assignment,
    required this.summary,
    required this.students,
  });

  final GradingAssignment assignment;
  final GradingSummary summary;
  final List<RosterStudent> students;

  factory GradingRoster.fromJson(Map<String, dynamic> json) {
    return GradingRoster(
      assignment: GradingAssignment.fromJson(
          json['assignment'] as Map<String, dynamic>? ?? const {}),
      summary: GradingSummary.fromJson(
          json['summary'] as Map<String, dynamic>? ?? const {}),
      students: (json['students'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RosterStudent.fromJson)
          .toList(),
    );
  }
}

class GradingAssignment {
  const GradingAssignment({
    required this.id,
    required this.title,
    required this.sectionSubjectId,
    required this.marksAvailable,
    required this.gradesReleased,
    required this.dueAt,
    required this.latePolicy,
  });

  final String id;
  final String title;
  final String sectionSubjectId;
  final int marksAvailable;
  final bool gradesReleased;
  final String dueAt;
  final String latePolicy;

  factory GradingAssignment.fromJson(Map<String, dynamic> json) {
    return GradingAssignment(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      marksAvailable: (json['marksAvailable'] as num?)?.toInt() ?? 0,
      gradesReleased: json['gradesReleased'] as bool? ?? false,
      dueAt: json['dueAt'] as String? ?? '',
      latePolicy: json['latePolicy'] as String? ?? 'FLAG_ONLY',
    );
  }
}

class GradingSummary {
  const GradingSummary({
    required this.enrolled,
    required this.submitted,
    required this.notSubmitted,
    required this.late,
    required this.graded,
    required this.ungraded,
  });

  final int enrolled;
  final int submitted;
  final int notSubmitted;
  final int late;
  final int graded;
  final int ungraded;

  factory GradingSummary.fromJson(Map<String, dynamic> json) {
    return GradingSummary(
      enrolled: (json['enrolled'] as num?)?.toInt() ?? 0,
      submitted: (json['submitted'] as num?)?.toInt() ?? 0,
      notSubmitted: (json['notSubmitted'] as num?)?.toInt() ?? 0,
      late: (json['late'] as num?)?.toInt() ?? 0,
      graded: (json['graded'] as num?)?.toInt() ?? 0,
      ungraded: (json['ungraded'] as num?)?.toInt() ?? 0,
    );
  }
}

// ------------------------------------------------------------------ Quiz Marking

class MarkableAnswer {
  const MarkableAnswer({
    required this.answerId,
    required this.attemptId,
    required this.studentName,
    this.rollNo,
    required this.attemptNumber,
    required this.questionId,
    required this.stem,
    required this.questionType,
    required this.marksAvailable,
    this.response,
    this.marksAwarded,
    this.graderComment,
    required this.isMarked,
  });

  final String answerId;
  final String attemptId;
  final String studentName;
  final int? rollNo;
  final int attemptNumber;
  final String questionId;
  final String stem;
  final String questionType;
  final int marksAvailable;
  final dynamic response;
  final num? marksAwarded;
  final String? graderComment;
  final bool isMarked;

  factory MarkableAnswer.fromJson(Map<String, dynamic> json) {
    return MarkableAnswer(
      answerId: json['answerId'] as String? ?? '',
      attemptId: json['attemptId'] as String? ?? '',
      studentName: json['studentName'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      attemptNumber: (json['attemptNumber'] as num?)?.toInt() ?? 1,
      questionId: json['questionId'] as String? ?? '',
      stem: json['stem'] as String? ?? '',
      questionType: json['questionType'] as String? ?? '',
      marksAvailable: (json['marksAvailable'] as num?)?.toInt() ?? 0,
      response: json['response'],
      marksAwarded: json['marksAwarded'] as num?,
      graderComment: json['graderComment'] as String?,
      isMarked: json['isMarked'] as bool? ?? false,
    );
  }

  String get responseText {
    if (response == null) return '(no answer given)';
    if (response is Map && response.containsKey('text')) {
      return response['text']?.toString() ?? '(no answer given)';
    }
    return response.toString();
  }
}

class MarkingQueue {
  const MarkingQueue({
    required this.quiz,
    required this.answers,
    required this.remaining,
  });

  final QuizInfo quiz;
  final List<MarkableAnswer> answers;
  final int remaining;

  factory MarkingQueue.fromJson(Map<String, dynamic> json) {
    return MarkingQueue(
      quiz: QuizInfo.fromJson(
          json['quiz'] as Map<String, dynamic>? ?? const {}),
      answers: (json['answers'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(MarkableAnswer.fromJson)
          .toList(),
      remaining: (json['remaining'] as num?)?.toInt() ?? 0,
    );
  }
}

class QuizInfo {
  const QuizInfo({
    required this.id,
    required this.title,
    required this.totalMarks,
  });

  final String id;
  final String title;
  final int totalMarks;

  factory QuizInfo.fromJson(Map<String, dynamic> json) {
    return QuizInfo(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      totalMarks: (json['totalMarks'] as num?)?.toInt() ?? 0,
    );
  }
}
