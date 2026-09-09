import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/marking_repository.dart';
import '../data/models/marking_models.dart';

// ── Marking Queue Cubit ──

class MarkingQueueState extends Equatable {
  const MarkingQueueState({
    this.status = MarkingQueueStatus.initial,
    this.sections = const [],
    this.selectedSection,
    this.assignments = const [],
    this.quizzes = const [],
    this.error,
  });

  final MarkingQueueStatus status;
  final List<TeacherSection> sections;
  final TeacherSection? selectedSection;
  final List<TeacherAssignment> assignments;
  final List<TeacherQuiz> quizzes;
  final ApiException? error;

  @override
  List<Object?> get props =>
      [status, sections, selectedSection, assignments, quizzes, error];

  MarkingQueueState copyWith({
    MarkingQueueStatus? status,
    List<TeacherSection>? sections,
    TeacherSection? selectedSection,
    List<TeacherAssignment>? assignments,
    List<TeacherQuiz>? quizzes,
    ApiException? error,
    bool clearError = false,
  }) {
    return MarkingQueueState(
      status: status ?? this.status,
      sections: sections ?? this.sections,
      selectedSection: selectedSection ?? this.selectedSection,
      assignments: assignments ?? this.assignments,
      quizzes: quizzes ?? this.quizzes,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

enum MarkingQueueStatus { initial, loading, loaded, failure }

class MarkingQueueCubit extends Cubit<MarkingQueueState> {
  MarkingQueueCubit(this._repo) : super(const MarkingQueueState());
  final MarkingRepository _repo;

  Future<void> loadSections() async {
    emit(state.copyWith(status: MarkingQueueStatus.loading, clearError: true));
    try {
      final sections = await _repo.getTeacherSections();
      if (isClosed) return;
      emit(state.copyWith(
        status: MarkingQueueStatus.loaded,
        sections: sections,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: MarkingQueueStatus.failure, error: e));
    }
  }

  Future<void> selectSection(TeacherSection section) async {
    emit(state.copyWith(
      status: MarkingQueueStatus.loading,
      selectedSection: section,
      clearError: true,
    ));
    try {
      final results = await Future.wait([
        _repo.getAssignmentQueue(sectionSubjectId: section.sectionSubjectId),
        _repo.getQuizQueue(sectionSubjectId: section.sectionSubjectId),
      ]);
      if (isClosed) return;
      emit(state.copyWith(
        status: MarkingQueueStatus.loaded,
        assignments: results[0] as List<TeacherAssignment>,
        quizzes: results[1] as List<TeacherQuiz>,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: MarkingQueueStatus.failure, error: e));
    }
  }
}

// ── Grading Cubit ──

class GradingState extends Equatable {
  const GradingState({
    this.status = GradingStatus.initial,
    this.roster,
    this.selectedStudentIndex,
    this.grading = false,
    this.error,
  });

  final GradingStatus status;
  final GradingRoster? roster;
  final int? selectedStudentIndex;
  final bool grading;
  final ApiException? error;

  RosterStudent? get selectedStudent =>
      roster != null && selectedStudentIndex != null
          ? roster!.students[selectedStudentIndex!]
          : null;

  @override
  List<Object?> get props =>
      [status, roster, selectedStudentIndex, grading, error];

  GradingState copyWith({
    GradingStatus? status,
    GradingRoster? roster,
    int? selectedStudentIndex,
    bool? grading,
    ApiException? error,
    bool clearError = false,
  }) {
    return GradingState(
      status: status ?? this.status,
      roster: roster ?? this.roster,
      selectedStudentIndex: selectedStudentIndex ?? this.selectedStudentIndex,
      grading: grading ?? this.grading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

enum GradingStatus { initial, loading, loaded, failure }

class GradingCubit extends Cubit<GradingState> {
  GradingCubit(this._repo) : super(const GradingState());
  final MarkingRepository _repo;

  Future<void> loadRoster(String assignmentId) async {
    emit(state.copyWith(status: GradingStatus.loading, clearError: true));
    try {
      final roster = await _repo.getGradingRoster(assignmentId: assignmentId);
      if (isClosed) return;
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        selectedStudentIndex: null,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: GradingStatus.failure, error: e));
    }
  }

  void selectStudent(int index) {
    emit(state.copyWith(selectedStudentIndex: index));
  }

  void nextStudent() {
    final roster = state.roster;
    if (roster == null) return;
    final current = state.selectedStudentIndex ?? -1;
    if (current < roster.students.length - 1) {
      emit(state.copyWith(selectedStudentIndex: current + 1));
    }
  }

  void previousStudent() {
    final current = state.selectedStudentIndex ?? 0;
    if (current > 0) {
      emit(state.copyWith(selectedStudentIndex: current - 1));
    }
  }

  void clearSelectedStudent() {
    emit(state.copyWith(selectedStudentIndex: null));
  }

  Future<void> gradeStudent({
    required String assignmentId,
    required String studentId,
    required num rawMarks,
    num? penaltyApplied,
    String? feedback,
    String? internalNotes,
  }) async {
    emit(state.copyWith(grading: true, clearError: true));
    try {
      await _repo.gradeStudent(
        assignmentId: assignmentId,
        studentId: studentId,
        rawMarks: rawMarks,
        penaltyApplied: penaltyApplied,
        feedback: feedback,
        internalNotes: internalNotes,
      );
      final roster = await _repo.getGradingRoster(assignmentId: assignmentId);
      if (isClosed) return;
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        grading: false,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(grading: false, error: e));
    }
  }

  Future<void> releaseGrades(String assignmentId) async {
    emit(state.copyWith(grading: true, clearError: true));
    try {
      await _repo.releaseGrades(assignmentId: assignmentId);
      final roster = await _repo.getGradingRoster(assignmentId: assignmentId);
      if (isClosed) return;
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        grading: false,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(grading: false, error: e));
    }
  }
}

// ── Quiz Marking Cubit ──

class QuizMarkingState extends Equatable {
  const QuizMarkingState({
    this.status = QuizMarkingStatus.initial,
    this.queue,
    this.currentIndex = 0,
    this.marking = false,
    this.error,
  });

  final QuizMarkingStatus status;
  final MarkingQueue? queue;
  final int currentIndex;
  final bool marking;
  final ApiException? error;

  MarkableAnswer? get currentAnswer =>
      queue != null && currentIndex < queue!.answers.length
          ? queue!.answers[currentIndex]
          : null;

  bool get hasMore => queue != null && currentIndex < queue!.answers.length - 1;

  @override
  List<Object?> get props => [status, queue, currentIndex, marking, error];

  QuizMarkingState copyWith({
    QuizMarkingStatus? status,
    MarkingQueue? queue,
    int? currentIndex,
    bool? marking,
    ApiException? error,
    bool clearError = false,
  }) {
    return QuizMarkingState(
      status: status ?? this.status,
      queue: queue ?? this.queue,
      currentIndex: currentIndex ?? this.currentIndex,
      marking: marking ?? this.marking,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

enum QuizMarkingStatus { initial, loading, loaded, failure }

class QuizMarkingCubit extends Cubit<QuizMarkingState> {
  QuizMarkingCubit(this._repo) : super(const QuizMarkingState());
  final MarkingRepository _repo;

  Future<void> loadQueue(String quizId) async {
    emit(state.copyWith(status: QuizMarkingStatus.loading, clearError: true));
    try {
      final queue = await _repo.getMarkingQueue(quizId: quizId);
      if (isClosed) return;
      emit(state.copyWith(
        status: QuizMarkingStatus.loaded,
        queue: queue,
        currentIndex: 0,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: QuizMarkingStatus.failure, error: e));
    }
  }

  Future<void> saveMark({
    required String answerId,
    required num marksAwarded,
    String? graderComment,
    String? quizId,
  }) async {
    emit(state.copyWith(marking: true, clearError: true));
    try {
      await _repo.saveQuizMark(
        answerId: answerId,
        marksAwarded: marksAwarded,
        graderComment: graderComment,
      );
      if (state.hasMore) {
        emit(state.copyWith(
          marking: false,
          currentIndex: state.currentIndex + 1,
        ));
      } else if (quizId != null) {
        final queue = await _repo.getMarkingQueue(quizId: quizId);
        if (isClosed) return;
        emit(state.copyWith(
          status: QuizMarkingStatus.loaded,
          queue: queue,
          currentIndex: 0,
          marking: false,
        ));
      } else {
        emit(state.copyWith(marking: false));
      }
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(marking: false, error: e));
    }
  }

  void previousAnswer() {
    if (state.currentIndex > 0) {
      emit(state.copyWith(currentIndex: state.currentIndex - 1));
    }
  }

  Future<void> releaseQuizGrades(String quizId) async {
    emit(state.copyWith(marking: true, clearError: true));
    try {
      await _repo.releaseQuizGrades(quizId: quizId);
      final queue = await _repo.getMarkingQueue(quizId: quizId);
      if (isClosed) return;
      emit(state.copyWith(
        status: QuizMarkingStatus.loaded,
        queue: queue,
        currentIndex: 0,
        marking: false,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(marking: false, error: e));
    }
  }
}
