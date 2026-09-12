import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/models/quiz_paper_models.dart';
import '../data/quiz_paper_repository.dart';

enum QuizPaperStatus { initial, loading, loaded, failure }

class QuizPaperState extends Equatable {
  const QuizPaperState({
    this.status = QuizPaperStatus.initial,
    this.paper,
    this.busy = false,
    this.justPublished = false,
    this.problems = const [],
    this.error,
  });

  final QuizPaperStatus status;
  final QuizPaper? paper;
  final bool busy;

  /// Shown once, after the teacher publishes — "students can sit this now" is
  /// worth saying plainly, because it is the irreversible step.
  final bool justPublished;

  /// Every complaint at once (NFR-ERR-005), which matters most on publish:
  /// FR-QIZ-020 can reject a paper for several reasons together.
  final List<String> problems;
  final ApiException? error;

  @override
  List<Object?> get props =>
      [status, paper, busy, justPublished, problems, error];

  QuizPaperState copyWith({
    QuizPaperStatus? status,
    QuizPaper? paper,
    bool? busy,
    bool? justPublished,
    List<String>? problems,
    ApiException? error,
    bool clearError = false,
  }) {
    return QuizPaperState(
      status: status ?? this.status,
      paper: paper ?? this.paper,
      busy: busy ?? this.busy,
      justPublished: justPublished ?? this.justPublished,
      problems: problems ?? this.problems,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class QuizPaperCubit extends Cubit<QuizPaperState> {
  QuizPaperCubit(this._repo, this.quizId) : super(const QuizPaperState());

  final QuizPaperRepository _repo;
  final String quizId;

  Future<void> load() async {
    emit(state.copyWith(status: QuizPaperStatus.loading, clearError: true));
    try {
      final paper = await _repo.detail(quizId);
      if (isClosed) return;
      emit(state.copyWith(status: QuizPaperStatus.loaded, paper: paper));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: QuizPaperStatus.failure, error: e));
    }
  }

  Future<void> addQuestion(String questionId, {double? marks}) =>
      _act(() => _repo.addQuestion(
            quizId: quizId,
            questionId: questionId,
            marks: marks,
          ));

  Future<void> removeQuestion(String questionId) =>
      _act(() => _repo.removeQuestion(quizId: quizId, questionId: questionId));

  Future<void> publish() async {
    await _act(() => _repo.publish(quizId));
    if (isClosed) return;
    if (state.problems.isEmpty && state.paper?.isLocked == true) {
      emit(state.copyWith(justPublished: true));
    }
  }

  /// Every mutation reloads the paper rather than patching state, because the
  /// server recomputes totalMarks and displayOrder on each change and a
  /// locally-guessed total is a total that will eventually be wrong.
  Future<void> _act(Future<void> Function() action) async {
    emit(state.copyWith(busy: true, problems: const [], clearError: true));
    try {
      await action();
      if (isClosed) return;
      final paper = await _repo.detail(quizId);
      if (isClosed) return;
      emit(state.copyWith(busy: false, paper: paper));
    } on ApiException catch (e) {
      if (isClosed) return;
      final lines = e.details
          .map((d) => (d['message'] as String? ?? '').trim())
          .where((line) => line.isNotEmpty)
          .toList();
      emit(state.copyWith(
        busy: false,
        problems: lines.isEmpty ? [e.message] : lines,
      ));
    }
  }
}
