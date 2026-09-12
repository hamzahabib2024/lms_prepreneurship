import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/models/student_quiz_models.dart';
import '../data/student_quiz_repository.dart';

enum StudentQuizStatus { initial, loading, loaded, failure }

class StudentQuizState extends Equatable {
  const StudentQuizState({
    this.status = StudentQuizStatus.initial,
    this.quizzes = const [],
    this.error,
    this.starting,
  });

  final StudentQuizStatus status;
  final List<StudentQuiz> quizzes;
  final ApiException? error;

  /// The quiz whose Start button was pressed, so only that row shows a
  /// spinner rather than the whole panel going blank.
  final String? starting;

  @override
  List<Object?> get props => [status, quizzes, error, starting];

  StudentQuizState copyWith({
    StudentQuizStatus? status,
    List<StudentQuiz>? quizzes,
    ApiException? error,
    String? starting,
    bool clearError = false,
    bool clearStarting = false,
  }) {
    return StudentQuizState(
      status: status ?? this.status,
      quizzes: quizzes ?? this.quizzes,
      error: clearError ? null : (error ?? this.error),
      starting: clearStarting ? null : (starting ?? this.starting),
    );
  }
}

class StudentQuizCubit extends Cubit<StudentQuizState> {
  StudentQuizCubit(this._repo, this.sectionSubjectId)
      : super(const StudentQuizState());

  final StudentQuizRepository _repo;
  final String sectionSubjectId;

  Future<void> load() async {
    emit(state.copyWith(status: StudentQuizStatus.loading, clearError: true));
    try {
      final quizzes = await _repo.myQuizzes(sectionSubjectId);
      if (isClosed) return;
      emit(state.copyWith(status: StudentQuizStatus.loaded, quizzes: quizzes));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: StudentQuizStatus.failure, error: e));
    }
  }

  /// Returns the attempt so the caller can push the runner, or null when the
  /// server declined — in which case the reason is already in [state.error].
  Future<QuizAttempt?> start(String quizId) async {
    emit(state.copyWith(starting: quizId, clearError: true));
    try {
      final attempt = await _repo.startOrResume(quizId);
      if (isClosed) return null;
      emit(state.copyWith(clearStarting: true));
      return attempt;
    } on ApiException catch (e) {
      if (isClosed) return null;
      emit(state.copyWith(error: e, clearStarting: true));
      return null;
    }
  }
}

/// One attempt, in progress.
///
/// Kept apart from [StudentQuizCubit] because it has a lifetime of its own:
/// it owns a ticking timer and a set of unsaved edits, and both must end when
/// the runner closes rather than when the subject page does.
class QuizAttemptState extends Equatable {
  const QuizAttemptState({
    required this.attempt,
    required this.answers,
    this.remainingSeconds,
    this.savingQuestionId,
    this.saveFailed = false,
    this.submitting = false,
    this.outcome,
    this.error,
  });

  final QuizAttempt attempt;

  /// questionId → response payload, as it will be sent.
  final Map<String, dynamic> answers;

  /// A display of the server's figure, counted down locally. Null when the
  /// quiz is untimed.
  final int? remainingSeconds;
  final String? savingQuestionId;

  /// An answer did not reach the server. Said plainly, because the student
  /// needs to know that this one is not safe yet.
  final bool saveFailed;
  final bool submitting;
  final AttemptOutcome? outcome;
  final ApiException? error;

  int get answeredCount =>
      attempt.questions.where((q) => answers[q.questionId] != null).length;

  bool get isTimed => remainingSeconds != null;

  @override
  List<Object?> get props => [
        attempt.attemptId,
        answers,
        remainingSeconds,
        savingQuestionId,
        saveFailed,
        submitting,
        outcome,
        error,
      ];

  QuizAttemptState copyWith({
    Map<String, dynamic>? answers,
    int? remainingSeconds,
    String? savingQuestionId,
    bool? saveFailed,
    bool? submitting,
    AttemptOutcome? outcome,
    ApiException? error,
    bool clearSaving = false,
    bool clearError = false,
  }) {
    return QuizAttemptState(
      attempt: attempt,
      answers: answers ?? this.answers,
      remainingSeconds: remainingSeconds ?? this.remainingSeconds,
      savingQuestionId:
          clearSaving ? null : (savingQuestionId ?? this.savingQuestionId),
      saveFailed: saveFailed ?? this.saveFailed,
      submitting: submitting ?? this.submitting,
      outcome: outcome ?? this.outcome,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class QuizAttemptCubit extends Cubit<QuizAttemptState> {
  QuizAttemptCubit(this._repo, QuizAttempt attempt)
      : super(QuizAttemptState(
          attempt: attempt,
          answers: Map<String, dynamic>.from(attempt.savedAnswers),
          remainingSeconds: attempt.remainingSeconds,
        )) {
    if (attempt.remainingSeconds != null) _startClock();
  }

  final StudentQuizRepository _repo;
  Timer? _clock;

  /// Guards against submitting twice — the clock reaching zero at the same
  /// moment the student presses the button is not a rare race on a phone,
  /// where the app is often backgrounded and resumed.
  bool _finished = false;

  void _startClock() {
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (isClosed) return;
      final left = state.remainingSeconds;
      if (left == null) return;
      final next = left - 1;
      if (next <= 0) {
        emit(state.copyWith(remainingSeconds: 0));
        unawaited(submit(auto: true));
      } else {
        emit(state.copyWith(remainingSeconds: next));
      }
    });
  }

  /// FR-QIZ-026 — optimistic locally, then persisted.
  ///
  /// The answer goes into state first so the control does not lag behind the
  /// finger; a failure is reported without taking it back, because the
  /// student's intent was not wrong, only the connection.
  Future<void> answer(String questionId, Map<String, dynamic>? response) async {
    final next = Map<String, dynamic>.from(state.answers);
    if (response == null) {
      next.remove(questionId);
    } else {
      next[questionId] = response;
    }
    emit(state.copyWith(
      answers: next,
      savingQuestionId: questionId,
      saveFailed: false,
    ));

    try {
      await _repo.saveAnswer(
        attemptId: state.attempt.attemptId,
        questionId: questionId,
        response: response,
      );
      if (isClosed) return;
      emit(state.copyWith(clearSaving: true));
    } on ApiException {
      if (isClosed) return;
      emit(state.copyWith(clearSaving: true, saveFailed: true));
    }
  }

  /// [auto] is true when the displayed clock ran out. A failure then is not
  /// worth alarming the student about: the server finalises an expired
  /// attempt whether or not this request arrived.
  Future<void> submit({bool auto = false}) async {
    if (_finished) return;
    _finished = true;
    _clock?.cancel();
    emit(state.copyWith(submitting: true, clearError: true));
    try {
      final outcome = await _repo.submit(state.attempt.attemptId);
      if (isClosed) return;
      emit(state.copyWith(submitting: false, outcome: outcome));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        submitting: false,
        error: auto ? null : e,
        outcome: auto
            ? AttemptOutcome(
                attemptId: state.attempt.attemptId,
                status: 'SUBMITTED',
                score: null,
                totalMarks: null,
                awaitingMarking: false,
                resultVisible: false,
              )
            : null,
      ));
    }
  }

  @override
  Future<void> close() {
    _clock?.cancel();
    return super.close();
  }
}
