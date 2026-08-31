import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/quiz_builder_repository.dart';
import '../data/models/quiz_builder_models.dart';

class QuizBuilderState extends Equatable {
  const QuizBuilderState({
    this.status = QuizBuilderStatus.initial,
    this.quizzes = const [],
    this.title = '',
    this.sectionSubjectId = '',
    this.totalMarks = 0,
    this.opensAt = '',
    this.closesAt = '',
    this.durationMinutes = 60,
    this.publicationStatus = 'DRAFT',
    this.questions = const [],
    this.saving,
    this.error,
  });

  final QuizBuilderStatus status;
  final List<QuizSummary> quizzes;
  final String title;
  final String sectionSubjectId;
  final int totalMarks;
  final String opensAt;
  final String closesAt;
  final int durationMinutes;
  final String publicationStatus;
  final List<QuizQuestion> questions;
  final bool? saving;
  final String? error;

  @override
  List<Object?> get props => [
    status, quizzes, title, sectionSubjectId,
    totalMarks, opensAt, closesAt, durationMinutes,
    publicationStatus, questions, saving, error,
  ];

  QuizBuilderState copyWith({
    QuizBuilderStatus? status,
    List<QuizSummary>? quizzes,
    String? title,
    String? sectionSubjectId,
    int? totalMarks,
    String? opensAt,
    String? closesAt,
    int? durationMinutes,
    String? publicationStatus,
    List<QuizQuestion>? questions,
    bool? saving,
    String? error,
  }) {
    return QuizBuilderState(
      status: status ?? this.status,
      quizzes: quizzes ?? this.quizzes,
      title: title ?? this.title,
      sectionSubjectId: sectionSubjectId ?? this.sectionSubjectId,
      totalMarks: totalMarks ?? this.totalMarks,
      opensAt: opensAt ?? this.opensAt,
      closesAt: closesAt ?? this.closesAt,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      publicationStatus: publicationStatus ?? this.publicationStatus,
      questions: questions ?? this.questions,
      saving: saving ?? this.saving,
      error: error ?? this.error,
    );
  }
}

enum QuizBuilderStatus { initial, loading, loaded, saving, failure, saved }

String _newId() => DateTime.now().microsecondsSinceEpoch.toRadixString(36);

class QuizBuilderCubit extends Cubit<QuizBuilderState> {
  QuizBuilderCubit(this._repo, {this.quizId})
      : super(const QuizBuilderState());
  final QuizBuilderRepository _repo;
  final String? quizId;

  Future<void> loadQuizzes(String sectionSubjectId) async {
    emit(state.copyWith(
      status: QuizBuilderStatus.loading,
      sectionSubjectId: sectionSubjectId,
    ));
    try {
      final quizzes = await _repo.getQuizzes(sectionSubjectId);
      emit(state.copyWith(
        status: QuizBuilderStatus.loaded,
        quizzes: quizzes,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: QuizBuilderStatus.failure,
        error: 'Failed to load quizzes: $e',
      ));
    }
  }

  void updateTitle(String value) => emit(state.copyWith(title: value));
  void updateOpensAt(String value) => emit(state.copyWith(opensAt: value));
  void updateClosesAt(String value) => emit(state.copyWith(closesAt: value));
  void updateDurationMinutes(int value) => emit(state.copyWith(durationMinutes: value));
  void updatePublicationStatus(String value) => emit(state.copyWith(publicationStatus: value));

  void addQuestion(String type) {
    final question = QuizQuestion(
      id: _newId(),
      type: type,
      stem: '',
      marks: 1,
      options: type == 'MCQ' || type == 'MCQ_MULTI'
          ? [
              QuizOption(id: _newId(), text: ''),
              QuizOption(id: _newId(), text: ''),
              QuizOption(id: _newId(), text: ''),
              QuizOption(id: _newId(), text: ''),
            ]
          : [],
    );
    emit(state.copyWith(questions: [...state.questions, question]));
    _recalculateMarks();
  }

  void updateQuestionStem(String questionId, String stem) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: stem,
          marks: q.marks,
          options: q.options,
          correctAnswer: q.correctAnswer,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
  }

  void updateQuestionMarks(String questionId, int marks) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: q.stem,
          marks: marks,
          options: q.options,
          correctAnswer: q.correctAnswer,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
    _recalculateMarks();
  }

  void updateOptionText(String questionId, String optionId, String text) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        final options = q.options.map((o) {
          if (o.id == optionId) return QuizOption(id: o.id, text: text, isCorrect: o.isCorrect);
          return o;
        }).toList();
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: q.stem,
          marks: q.marks,
          options: options,
          correctAnswer: q.correctAnswer,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
  }

  void setCorrectAnswer(String questionId, String optionId) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        if (q.type == 'MCQ_MULTI') {
          // Toggle multi-select
          final currentCorrect = q.correctAnswer?.split(',').where((s) => s.isNotEmpty).toSet() ?? {};
          if (currentCorrect.contains(optionId)) {
            currentCorrect.remove(optionId);
          } else {
            currentCorrect.add(optionId);
          }
          final options = q.options.map((o) {
            return QuizOption(id: o.id, text: o.text, isCorrect: currentCorrect.contains(o.id));
          }).toList();
          return QuizQuestion(
            id: q.id,
            type: q.type,
            stem: q.stem,
            marks: q.marks,
            options: options,
            correctAnswer: currentCorrect.join(','),
          );
        }
        // Single select
        final options = q.options.map((o) {
          return QuizOption(id: o.id, text: o.text, isCorrect: o.id == optionId);
        }).toList();
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: q.stem,
          marks: q.marks,
          options: options,
          correctAnswer: optionId,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
  }

  void setCorrectAnswerText(String questionId, String text) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: q.stem,
          marks: q.marks,
          options: q.options,
          correctAnswer: text,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
  }

  void addOption(String questionId) {
    final questions = state.questions.map((q) {
      if (q.id == questionId) {
        final options = [...q.options, QuizOption(id: _newId(), text: '')];
        return QuizQuestion(
          id: q.id,
          type: q.type,
          stem: q.stem,
          marks: q.marks,
          options: options,
          correctAnswer: q.correctAnswer,
        );
      }
      return q;
    }).toList();
    emit(state.copyWith(questions: questions));
  }

  void removeQuestion(String questionId) {
    final questions = state.questions.where((q) => q.id != questionId).toList();
    emit(state.copyWith(questions: questions));
    _recalculateMarks();
  }

  void _recalculateMarks() {
    final total = state.questions.fold<int>(0, (sum, q) => sum + q.marks);
    emit(state.copyWith(totalMarks: total));
  }

  Future<void> save() async {
    if (state.title.isEmpty) {
      emit(state.copyWith(error: 'Title is required'));
      return;
    }
    if (state.sectionSubjectId.isEmpty) {
      emit(state.copyWith(error: 'Select a section/subject'));
      return;
    }

    emit(state.copyWith(saving: true, error: null));
    try {
      final draft = QuizDraft(
        id: quizId,
        title: state.title,
        sectionSubjectId: state.sectionSubjectId,
        totalMarks: state.totalMarks,
        opensAt: state.opensAt,
        closesAt: state.closesAt,
        durationMinutes: state.durationMinutes,
        publicationStatus: state.publicationStatus,
        questions: state.questions,
      );

      if (quizId != null) {
        await _repo.updateQuiz(draft);
      } else {
        await _repo.createQuiz(draft);
      }

      emit(state.copyWith(
        status: QuizBuilderStatus.saved,
        saving: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        saving: false,
        error: 'Failed to save quiz: $e',
      ));
    }
  }

  Future<void> publish() async {
    if (quizId == null) {
      emit(state.copyWith(error: 'Save the quiz first'));
      return;
    }
    emit(state.copyWith(saving: true));
    try {
      await _repo.publishQuiz(quizId!);
      emit(state.copyWith(
        status: QuizBuilderStatus.saved,
        publicationStatus: 'PUBLISHED',
        saving: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        saving: false,
        error: 'Failed to publish: $e',
      ));
    }
  }
}
