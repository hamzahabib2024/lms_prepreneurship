/// The student's side of a quiz — SRS §5.10, §13.5, FR-QIZ-023..028.
///
/// Mirrors the shapes the web client reads in components/QuizPanel.tsx. Two
/// things are worth keeping in mind while reading these classes.
///
/// FIRST, NO ANSWER KEY EVER ARRIVES HERE. The server projects a question for
/// a student without `isCorrect`, `explanation` or `acceptedAnswers`
/// (SEC-AUZ-009, BR-QIZ-07), so there is nowhere in [StudentQuestion] to put
/// one. That is deliberate: a field added here would invite a future endpoint
/// to fill it.
///
/// SECOND, THE CLOCK IS THE SERVER'S. [QuizAttempt.remainingSeconds] is a
/// number the server computed from a start it recorded (BR-QIZ-04). The
/// countdown the interface draws from it is a display, never the authority —
/// the server decides when time is up and will finalise an abandoned attempt
/// on its own.
library;

class StudentQuiz {
  const StudentQuiz({
    required this.id,
    required this.title,
    required this.instructions,
    required this.totalMarks,
    required this.passingMarks,
    required this.opensAt,
    required this.closesAt,
    required this.timeLimitMinutes,
    required this.maxAttempts,
    required this.attemptsUsed,
    required this.negativeMarking,
    required this.isOpen,
    required this.opensLater,
    required this.hasClosed,
    required this.canAttempt,
    required this.inProgress,
    required this.awaitingMarking,
    required this.recordedScore,
    required this.scorePolicy,
  });

  final String id;
  final String title;
  final String? instructions;
  final double totalMarks;
  final double? passingMarks;
  final DateTime opensAt;
  final DateTime closesAt;
  final int? timeLimitMinutes;
  final int maxAttempts;
  final int attemptsUsed;

  /// `NONE`, `FIXED` or `PROPORTIONAL`. Stated before a student starts, not
  /// when they see the mark (FR-QIZ-013) — somebody deciding whether to guess
  /// needs it in advance.
  final String negativeMarking;

  final bool isOpen;
  final bool opensLater;
  final bool hasClosed;
  final bool canAttempt;
  final bool inProgress;

  /// A written answer is waiting on a human, so there is no score yet — which
  /// must read as "not yet", never as zero.
  final bool awaitingMarking;
  final double? recordedScore;
  final String scorePolicy;

  bool get penalisesWrongAnswers => negativeMarking != 'NONE';

  factory StudentQuiz.fromJson(Map<String, dynamic> json) {
    return StudentQuiz(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'Untitled quiz',
      instructions: json['instructions'] as String?,
      totalMarks: _num(json['totalMarks']) ?? 0,
      passingMarks: _num(json['passingMarks']),
      opensAt: DateTime.parse(json['opensAt'] as String).toLocal(),
      closesAt: DateTime.parse(json['closesAt'] as String).toLocal(),
      timeLimitMinutes: json['timeLimitMinutes'] as int?,
      maxAttempts: json['maxAttempts'] as int? ?? 1,
      attemptsUsed: json['attemptsUsed'] as int? ?? 0,
      negativeMarking: json['negativeMarking'] as String? ?? 'NONE',
      isOpen: json['isOpen'] as bool? ?? false,
      opensLater: json['opensLater'] as bool? ?? false,
      hasClosed: json['hasClosed'] as bool? ?? false,
      canAttempt: json['canAttempt'] as bool? ?? false,
      inProgress: json['inProgress'] as bool? ?? false,
      awaitingMarking: json['awaitingMarking'] as bool? ?? false,
      recordedScore: _num(json['recordedScore']),
      scorePolicy: json['scorePolicy'] as String? ?? 'LAST',
    );
  }
}

/// One question as a student may see it: the stem, its marks, and — for the
/// choice types — the options. Nothing else.
class StudentQuestion {
  const StudentQuestion({
    required this.questionId,
    required this.questionVersion,
    required this.displayOrder,
    required this.type,
    required this.stem,
    required this.marks,
    required this.options,
  });

  final String questionId;
  final int questionVersion;
  final int displayOrder;

  /// `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `SHORT_ANSWER`, `NUMERIC`, …
  final String type;
  final String stem;
  final double marks;

  /// Empty for the written and numeric types, which take free text instead.
  final List<QuestionOption> options;

  bool get isMultiSelect => type == 'MCQ_MULTI';
  bool get isChoice => options.isNotEmpty;
  bool get isNumeric => type == 'NUMERIC';

  factory StudentQuestion.fromJson(Map<String, dynamic> json) {
    return StudentQuestion(
      questionId: json['questionId'] as String,
      questionVersion: json['questionVersion'] as int? ?? 1,
      displayOrder: json['displayOrder'] as int? ?? 0,
      type: json['type'] as String? ?? 'SHORT_ANSWER',
      stem: json['stem'] as String? ?? '',
      marks: _num(json['marks']) ?? 0,
      options: (json['options'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(QuestionOption.fromJson)
          .toList(),
    );
  }
}

class QuestionOption {
  const QuestionOption({required this.optionId, required this.text});

  final String optionId;
  final String text;

  factory QuestionOption.fromJson(Map<String, dynamic> json) {
    return QuestionOption(
      optionId: json['optionId'] as String,
      text: json['text'] as String? ?? '',
    );
  }
}

/// An attempt in progress — the paper, the clock, and whatever was saved
/// before now (which is what makes a dropped connection cost nothing).
class QuizAttempt {
  const QuizAttempt({
    required this.attemptId,
    required this.attemptNumber,
    required this.resumed,
    required this.expiresAt,
    required this.remainingSeconds,
    required this.maxAttempts,
    required this.presentation,
    required this.allowBackwardNavigation,
    required this.questions,
    required this.savedAnswers,
  });

  final String attemptId;
  final int attemptNumber;

  /// True when the server handed back an attempt that was already open rather
  /// than starting a new one — the student closed the app and came back.
  final bool resumed;
  final DateTime? expiresAt;

  /// Null when the quiz has no time limit at all.
  final int? remainingSeconds;
  final int maxAttempts;
  final String presentation;
  final bool allowBackwardNavigation;
  final List<StudentQuestion> questions;

  /// questionId → the response shape for that question's type.
  final Map<String, dynamic> savedAnswers;

  factory QuizAttempt.fromJson(Map<String, dynamic> json) {
    return QuizAttempt(
      attemptId: json['attemptId'] as String,
      attemptNumber: json['attemptNumber'] as int? ?? 1,
      resumed: json['resumed'] as bool? ?? false,
      expiresAt: json['expiresAt'] == null
          ? null
          : DateTime.parse(json['expiresAt'] as String).toLocal(),
      remainingSeconds: json['remainingSeconds'] as int?,
      maxAttempts: json['maxAttempts'] as int? ?? 1,
      presentation: json['presentation'] as String? ?? 'ALL_ON_ONE_PAGE',
      allowBackwardNavigation: json['allowBackwardNavigation'] as bool? ?? true,
      questions: (json['questions'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(StudentQuestion.fromJson)
          .toList(),
      savedAnswers:
          (json['savedAnswers'] as Map<String, dynamic>?) ?? <String, dynamic>{},
    );
  }
}

/// What comes back when an attempt closes. `awaitingMarking` is the case that
/// matters: a partial score shown then would read as a failure.
class AttemptOutcome {
  const AttemptOutcome({
    required this.attemptId,
    required this.status,
    required this.score,
    required this.totalMarks,
    required this.awaitingMarking,
    required this.resultVisible,
  });

  final String attemptId;
  final String status;
  final double? score;
  final double? totalMarks;
  final bool awaitingMarking;

  /// The release policy has been satisfied, so a score may be shown.
  final bool resultVisible;

  factory AttemptOutcome.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String? ?? 'SUBMITTED';
    return AttemptOutcome(
      attemptId: json['attemptId'] as String? ?? json['id'] as String? ?? '',
      status: status,
      score: _num(json['finalScore'] ?? json['score']),
      totalMarks: _num(json['totalMarks']),
      awaitingMarking: json['awaitingMarking'] as bool? ?? status == 'GRADING',
      resultVisible: json['resultVisible'] as bool? ??
          (json['releasedAt'] != null),
    );
  }
}

double? _num(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}
