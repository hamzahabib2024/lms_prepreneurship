import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
  final String? error;

  @override
  List<Object?> get props =>
      [status, sections, selectedSection, assignments, quizzes, error];

  MarkingQueueState copyWith({
    MarkingQueueStatus? status,
    List<TeacherSection>? sections,
    TeacherSection? selectedSection,
    List<TeacherAssignment>? assignments,
    List<TeacherQuiz>? quizzes,
    String? error,
  }) {
    return MarkingQueueState(
      status: status ?? this.status,
      sections: sections ?? this.sections,
      selectedSection: selectedSection ?? this.selectedSection,
      assignments: assignments ?? this.assignments,
      quizzes: quizzes ?? this.quizzes,
      error: error ?? this.error,
    );
  }
}

enum MarkingQueueStatus { initial, loading, loaded, failure }

class MarkingQueueCubit extends Cubit<MarkingQueueState> {
  MarkingQueueCubit(this._repo) : super(const MarkingQueueState());
  final MarkingRepository _repo;

  Future<void> loadSections() async {
    emit(state.copyWith(status: MarkingQueueStatus.loading));
    try {
      final sections = await _repo.getTeacherSections();
      emit(state.copyWith(
        status: MarkingQueueStatus.loaded,
        sections: sections,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: MarkingQueueStatus.failure,
        error: 'Failed to load sections: $e',
      ));
    }
  }

  Future<void> selectSection(TeacherSection section) async {
    emit(state.copyWith(
      status: MarkingQueueStatus.loading,
      selectedSection: section,
    ));
    try {
      final results = await Future.wait([
        _repo.getAssignmentQueue(sectionSubjectId: section.sectionSubjectId),
        _repo.getQuizQueue(sectionSubjectId: section.sectionSubjectId),
      ]);
      emit(state.copyWith(
        status: MarkingQueueStatus.loaded,
        assignments: results[0] as List<TeacherAssignment>,
        quizzes: results[1] as List<TeacherQuiz>,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: MarkingQueueStatus.failure,
        error: 'Failed to load queue: $e',
      ));
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
  final String? error;

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
    String? error,
  }) {
    return GradingState(
      status: status ?? this.status,
      roster: roster ?? this.roster,
      selectedStudentIndex: selectedStudentIndex ?? this.selectedStudentIndex,
      grading: grading ?? this.grading,
      error: error ?? this.error,
    );
  }
}

enum GradingStatus { initial, loading, loaded, failure }

class GradingCubit extends Cubit<GradingState> {
  GradingCubit(this._repo) : super(const GradingState());
  final MarkingRepository _repo;

  Future<void> loadRoster(String assignmentId) async {
    emit(state.copyWith(status: GradingStatus.loading));
    try {
      final roster = await _repo.getGradingRoster(assignmentId: assignmentId);
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        selectedStudentIndex: null,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: GradingStatus.failure,
        error: 'Failed to load roster: $e',
      ));
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
    emit(state.copyWith(grading: true));
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
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        grading: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        grading: false,
        error: 'Failed to save grade: $e',
      ));
    }
  }

  Future<void> releaseGrades(String assignmentId) async {
    emit(state.copyWith(grading: true));
    try {
      await _repo.releaseGrades(assignmentId: assignmentId);
      final roster = await _repo.getGradingRoster(assignmentId: assignmentId);
      emit(state.copyWith(
        status: GradingStatus.loaded,
        roster: roster,
        grading: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        grading: false,
        error: 'Failed to release grades: $e',
      ));
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
  final String? error;

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
    String? error,
  }) {
    return QuizMarkingState(
      status: status ?? this.status,
      queue: queue ?? this.queue,
      currentIndex: currentIndex ?? this.currentIndex,
      marking: marking ?? this.marking,
      error: error ?? this.error,
    );
  }
}

enum QuizMarkingStatus { initial, loading, loaded, failure }

class QuizMarkingCubit extends Cubit<QuizMarkingState> {
  QuizMarkingCubit(this._repo) : super(const QuizMarkingState());
  final MarkingRepository _repo;

  Future<void> loadQueue(String quizId) async {
    emit(state.copyWith(status: QuizMarkingStatus.loading));
    try {
      final queue = await _repo.getMarkingQueue(quizId: quizId);
      emit(state.copyWith(
        status: QuizMarkingStatus.loaded,
        queue: queue,
        currentIndex: 0,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: QuizMarkingStatus.failure,
        error: 'Failed to load marking queue: $e',
      ));
    }
  }

  Future<void> saveMark({
    required String answerId,
    required num marksAwarded,
    String? graderComment,
    String? quizId,
  }) async {
    emit(state.copyWith(marking: true));
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
        emit(state.copyWith(
          status: QuizMarkingStatus.loaded,
          queue: queue,
          currentIndex: 0,
          marking: false,
        ));
      } else {
        emit(state.copyWith(marking: false));
      }
    } catch (e) {
      emit(state.copyWith(
        marking: false,
        error: 'Failed to save mark: $e',
      ));
    }
  }

  void previousAnswer() {
    if (state.currentIndex > 0) {
      emit(state.copyWith(currentIndex: state.currentIndex - 1));
    }
  }

  Future<void> releaseQuizGrades(String quizId) async {
    emit(state.copyWith(marking: true));
    try {
      await _repo.releaseQuizGrades(quizId: quizId);
      final queue = await _repo.getMarkingQueue(quizId: quizId);
      emit(state.copyWith(
        status: QuizMarkingStatus.loaded,
        queue: queue,
        currentIndex: 0,
        marking: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        marking: false,
        error: 'Failed to release grades: $e',
      ));
    }
  }
}
