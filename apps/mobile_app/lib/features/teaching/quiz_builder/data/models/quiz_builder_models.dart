/// Models for the quiz builder — SRS §13.6, FR-TCH-022.
library;

class QuizDraft {
  const QuizDraft({
    this.id,
    required this.title,
    required this.sectionSubjectId,
    required this.totalMarks,
    required this.opensAt,
    required this.closesAt,
    required this.durationMinutes,
    required this.publicationStatus,
    required this.questions,
  });

  final String? id;
  final String title;
  final String sectionSubjectId;
  final int totalMarks;
  final String opensAt;
  final String closesAt;
  final int durationMinutes;
  final String publicationStatus;
  final List<QuizQuestion> questions;

  Map<String, dynamic> toJson() => {
    if (id != null) 'id': id,
    'title': title,
    'sectionSubjectId': sectionSubjectId,
    'totalMarks': totalMarks,
    'opensAt': opensAt,
    'closesAt': closesAt,
    'durationMinutes': durationMinutes,
    'publicationStatus': publicationStatus,
    'questions': questions.map((q) => q.toJson()).toList(),
  };
}

class QuizQuestion {
  const QuizQuestion({
    required this.id,
    required this.type,
    required this.stem,
    required this.marks,
    required this.options,
    this.correctAnswer,
  });

  final String id;
  final String type;
  final String stem;
  final int marks;
  final List<QuizOption> options;
  final String? correctAnswer;

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'stem': stem,
    'marks': marks,
    'options': options.map((o) => o.toJson()).toList(),
    if (correctAnswer != null) 'correctAnswer': correctAnswer,
  };
}

class QuizOption {
  const QuizOption({
    required this.id,
    required this.text,
    this.isCorrect = false,
  });

  final String id;
  final String text;
  final bool isCorrect;

  Map<String, dynamic> toJson() => {
    'id': id,
    'text': text,
    'isCorrect': isCorrect,
  };
}

class QuizSummary {
  const QuizSummary({
    required this.id,
    required this.title,
    required this.sectionSubjectId,
    required this.totalMarks,
    required this.opensAt,
    required this.closesAt,
    required this.durationMinutes,
    required this.publicationStatus,
    required this.questionCount,
    required this.attemptCount,
    required this.awaitingMarking,
  });

  final String id;
  final String title;
  final String sectionSubjectId;
  final int totalMarks;
  final String opensAt;
  final String closesAt;
  final int durationMinutes;
  final String publicationStatus;
  final int questionCount;
  final int attemptCount;
  final int awaitingMarking;

  factory QuizSummary.fromJson(Map<String, dynamic> json) {
    return QuizSummary(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      sectionSubjectId: json['sectionSubjectId'] as String? ?? '',
      totalMarks: (json['totalMarks'] as num?)?.toInt() ?? 0,
      opensAt: json['opensAt'] as String? ?? '',
      closesAt: json['closesAt'] as String? ?? '',
      durationMinutes: (json['durationMinutes'] as num?)?.toInt() ?? 0,
      publicationStatus: json['publicationStatus'] as String? ?? 'DRAFT',
      questionCount: (json['questionCount'] as num?)?.toInt() ?? 0,
      attemptCount: (json['attemptCount'] as num?)?.toInt() ?? 0,
      awaitingMarking: (json['awaitingMarking'] as num?)?.toInt() ?? 0,
    );
  }
}
