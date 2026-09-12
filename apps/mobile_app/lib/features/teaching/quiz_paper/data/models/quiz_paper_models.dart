/// A quiz's paper — SRS §9.8, FR-QIZ-001..020.
library;

class QuizPaper {
  const QuizPaper({
    required this.id,
    required this.title,
    required this.instructions,
    required this.publicationStatus,
    required this.totalMarks,
    required this.passingMarks,
    required this.opensAt,
    required this.closesAt,
    required this.timeLimitMinutes,
    required this.maxAttempts,
    required this.negativeMarking,
    required this.resultReleasePolicy,
    required this.attemptCount,
    required this.questions,
  });

  final String id;
  final String title;
  final String? instructions;
  final String publicationStatus;
  final double totalMarks;
  final double? passingMarks;
  final DateTime opensAt;
  final DateTime closesAt;
  final int? timeLimitMinutes;
  final int maxAttempts;
  final String negativeMarking;
  final String resultReleasePolicy;

  /// How many students have sat it. The interface uses this to refuse to let
  /// a teacher edit a paper people have already answered.
  final int attemptCount;
  final List<PaperQuestion> questions;

  /// A published quiz is read-only. Somebody may be sitting it, and the
  /// server refuses the edit anyway — offering a button that will be refused
  /// wastes the teacher's time and teaches them to ignore errors.
  bool get isLocked => publicationStatus == 'PUBLISHED';

  Set<String> get questionIds =>
      questions.map((q) => q.questionId).toSet();

  factory QuizPaper.fromJson(Map<String, dynamic> json) {
    return QuizPaper(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'Untitled quiz',
      instructions: json['instructions'] as String?,
      publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
      totalMarks: (json['totalMarks'] as num?)?.toDouble() ?? 0,
      passingMarks: (json['passingMarks'] as num?)?.toDouble(),
      opensAt: DateTime.parse(json['opensAt'] as String).toLocal(),
      closesAt: DateTime.parse(json['closesAt'] as String).toLocal(),
      timeLimitMinutes: json['timeLimitMinutes'] as int?,
      maxAttempts: json['maxAttempts'] as int? ?? 1,
      negativeMarking: json['negativeMarking'] as String? ?? 'NONE',
      resultReleasePolicy: json['resultReleasePolicy'] as String? ?? 'AFTER_CLOSE',
      attemptCount: json['attemptCount'] as int? ?? 0,
      questions: (json['questions'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PaperQuestion.fromJson)
          .toList(),
    );
  }
}

class PaperQuestion {
  const PaperQuestion({
    required this.questionId,
    required this.displayOrder,
    required this.marks,
    required this.questionType,
    required this.stem,
  });

  final String questionId;
  final int displayOrder;

  /// Per QUIZ, not per question: the same bank question can be worth two
  /// marks on one paper and five on another.
  final double marks;
  final String questionType;
  final String stem;

  /// "MCQ_SINGLE" is how the database spells it; this is how a person reads it.
  String get typeLabel =>
      questionType.replaceAll('_', ' ').toLowerCase();

  factory PaperQuestion.fromJson(Map<String, dynamic> json) {
    return PaperQuestion(
      questionId: json['questionId'] as String,
      displayOrder: json['displayOrder'] as int? ?? 0,
      marks: (json['marks'] as num?)?.toDouble() ?? 0,
      questionType: json['questionType'] as String? ?? 'SHORT_ANSWER',
      stem: json['stem'] as String? ?? '',
    );
  }
}
