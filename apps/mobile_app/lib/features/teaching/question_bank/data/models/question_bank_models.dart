/// Question banks and the questions in them — SRS §9.8, FR-QIZ-004..012.
///
/// Everything here CARRIES THE ANSWER KEY, which is the opposite of the
/// student-side models beside it in features/learning/quizzes. That is
/// deliberate and safe for one reason worth writing down: §4.5 grants no
/// student key on `question`, `question_bank` or `quiz_answer_key`, and the
/// scope policy denies them those models outright — so nothing on this side
/// is reachable by a student even if a route were mis-guarded.
library;

/// The eight question types, with the words a teacher would use rather than
/// the enum spelling.
enum QuestionType {
  mcqSingle('MCQ_SINGLE', 'Multiple choice — one answer'),
  mcqMulti('MCQ_MULTI', 'Multiple choice — several answers'),
  trueFalse('TRUE_FALSE', 'True or false'),
  shortAnswer('SHORT_ANSWER', 'Short answer'),
  numeric('NUMERIC', 'Numeric'),
  fillBlank('FILL_BLANK', 'Fill in the blank'),
  essay('ESSAY', 'Essay — marked by you'),
  matching('MATCHING', 'Matching');

  const QuestionType(this.wire, this.label);

  final String wire;
  final String label;

  /// Answered by picking from a list.
  bool get hasOptions =>
      this == mcqSingle || this == mcqMulti || this == trueFalse;

  /// Answered by typing, and marked against a list of accepted answers.
  bool get hasAcceptedAnswers =>
      this == shortAnswer || this == numeric || this == fillBlank;

  /// Exactly one option may be right, so choosing one clears the others.
  bool get isSingleAnswer => this == mcqSingle || this == trueFalse;

  static QuestionType fromWire(String? wire) {
    for (final type in QuestionType.values) {
      if (type.wire == wire) return type;
    }
    return QuestionType.shortAnswer;
  }

  /// The set offered in the composer. MATCHING is omitted because its editor
  /// is a pair table that does not fit a phone; a bank holding one still
  /// lists and uses it, it simply cannot be written here.
  static const composable = <QuestionType>[
    mcqSingle,
    mcqMulti,
    trueFalse,
    shortAnswer,
    numeric,
    fillBlank,
    essay,
  ];
}

class QuestionBank {
  const QuestionBank({
    required this.id,
    required this.name,
    required this.subjectId,
    required this.questionCount,
  });

  final String id;
  final String name;
  final String? subjectId;
  final int questionCount;

  factory QuestionBank.fromJson(Map<String, dynamic> json) {
    return QuestionBank(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Untitled bank',
      subjectId: json['subjectId'] as String?,
      questionCount: json['questionCount'] as int? ?? 0,
    );
  }
}

class BankQuestion {
  const BankQuestion({
    required this.id,
    required this.type,
    required this.stem,
    required this.difficulty,
    required this.defaultMarks,
    required this.explanation,
    required this.acceptedAnswers,
    required this.isRetired,
    required this.options,
  });

  final String id;
  final QuestionType type;
  final String stem;
  final String? difficulty;
  final double defaultMarks;
  final String? explanation;

  /// For the typed types — a list of strings, or of numbers for NUMERIC.
  final List<String> acceptedAnswers;

  /// FR-QIZ-010 — retired, never deleted: past attempts refer to it.
  final bool isRetired;
  final List<BankOption> options;

  factory BankQuestion.fromJson(Map<String, dynamic> json) {
    final accepted = json['acceptedAnswers'];
    return BankQuestion(
      id: json['id'] as String,
      type: QuestionType.fromWire(json['questionType'] as String?),
      stem: json['stem'] as String? ?? '',
      difficulty: json['difficulty'] as String?,
      defaultMarks: (json['defaultMarks'] as num?)?.toDouble() ?? 1,
      explanation: json['explanation'] as String?,
      acceptedAnswers: accepted is List
          ? accepted.map((a) => a.toString()).toList()
          : const [],
      isRetired: json['isRetired'] as bool? ?? false,
      options: (json['options'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(BankOption.fromJson)
          .toList(),
    );
  }
}

class BankOption {
  const BankOption({
    required this.id,
    required this.optionText,
    required this.isCorrect,
  });

  final String id;
  final String optionText;
  final bool isCorrect;

  factory BankOption.fromJson(Map<String, dynamic> json) {
    return BankOption(
      id: json['id'] as String? ?? '',
      optionText: json['optionText'] as String? ?? '',
      isCorrect: json['isCorrect'] as bool? ?? false,
    );
  }
}

/// A question being written. Held as a draft rather than as a pile of
/// controller state so the composer can swap type without losing the stem.
class QuestionDraft {
  QuestionDraft({
    this.type = QuestionType.mcqSingle,
    this.stem = '',
    this.marks = '2',
    List<DraftOption>? options,
    this.acceptedAnswers = '',
  }) : options = options ??
            [DraftOption(), DraftOption()];

  QuestionType type;
  String stem;
  String marks;
  List<DraftOption> options;

  /// One accepted answer per line, as the web's composer takes them.
  String acceptedAnswers;

  /// Switching type reshapes the options rather than clearing the question:
  /// true/false has fixed options nobody should have to type, and a choice
  /// type always needs at least two rows to work with.
  void changeType(QuestionType next) {
    type = next;
    if (next == QuestionType.trueFalse) {
      options = [
        DraftOption(text: 'True'),
        DraftOption(text: 'False'),
      ];
    } else if (next.hasOptions && options.length < 2) {
      options = [DraftOption(), DraftOption()];
    }
  }

  /// Single-answer types cannot have two right answers, so the form does not
  /// let a teacher build a state the server would refuse.
  void markCorrect(int index, bool value) {
    for (var i = 0; i < options.length; i++) {
      if (i == index) {
        options[i].isCorrect = value;
      } else if (type.isSingleAnswer && value) {
        options[i].isCorrect = false;
      }
    }
  }

  /// The request body. Fields that do not apply to the type are omitted
  /// entirely rather than sent empty — an essay with an `options: []` reads
  /// as an essay somebody forgot to give options.
  Map<String, dynamic> toJson() {
    final body = <String, dynamic>{
      'questionType': type.wire,
      'stem': stem,
      'defaultMarks': num.tryParse(marks.trim()) ?? 0,
    };
    if (type.hasOptions) {
      body['options'] = options
          .map((o) => {'optionText': o.text, 'isCorrect': o.isCorrect})
          .toList();
    }
    if (type.hasAcceptedAnswers) {
      final lines = acceptedAnswers
          .split('\n')
          .map((line) => line.trim())
          .where((line) => line.isNotEmpty);
      body['acceptedAnswers'] = type == QuestionType.numeric
          ? lines.map((line) => num.tryParse(line) ?? line).toList()
          : lines.toList();
    }
    return body;
  }
}

class DraftOption {
  DraftOption({this.text = '', this.isCorrect = false});

  String text;
  bool isCorrect;
}
