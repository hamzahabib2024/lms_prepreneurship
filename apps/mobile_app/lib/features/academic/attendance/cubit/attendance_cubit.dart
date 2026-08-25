import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/attendance_repository.dart';
import '../data/models/attendance_models.dart';

class AttendanceState extends Equatable {
  const AttendanceState({
    this.status = AttendancePageStatus.loading,
    this.sessions = const [],
    this.selectedSessionId,
    this.register,
    this.marks = const {},
    this.saving = false,
    this.savedAt,
    this.error,
    this.saveError,
    this.successMessage,
  });

  final AttendancePageStatus status;
  final List<AttendanceSession> sessions;
  final String? selectedSessionId;
  final Register? register;
  final Map<String, String> marks;
  final bool saving;
  final DateTime? savedAt;
  final ApiException? error;
  final String? saveError;
  final String? successMessage;

  int get unmarked =>
      register?.students
              .where((s) => (marks[s.studentId] ?? 'NOT_MARKED') == 'NOT_MARKED')
              .length ??
          0;

  int get marked =>
      (register?.students.length ?? 0) - unmarked;

  AttendanceState copyWith({
    AttendancePageStatus? status,
    List<AttendanceSession>? sessions,
    String? selectedSessionId,
    Register? register,
    Map<String, String>? marks,
    bool? saving,
    DateTime? savedAt,
    ApiException? error,
    String? saveError,
    String? successMessage,
    bool clearError = false,
    bool clearSaveError = false,
    bool clearSuccess = false,
  }) =>
      AttendanceState(
        status: status ?? this.status,
        sessions: sessions ?? this.sessions,
        selectedSessionId: selectedSessionId ?? this.selectedSessionId,
        register: register ?? this.register,
        marks: marks ?? this.marks,
        saving: saving ?? this.saving,
        savedAt: savedAt ?? this.savedAt,
        error: clearError ? null : (error ?? this.error),
        saveError: clearSaveError ? null : (saveError ?? this.saveError),
        successMessage:
            clearSuccess ? null : (successMessage ?? this.successMessage),
      );

  @override
  List<Object?> get props => [
        status,
        sessions,
        selectedSessionId,
        register,
        marks,
        saving,
        savedAt,
        error,
        saveError,
        successMessage,
      ];
}

enum AttendancePageStatus { loading, loaded, failure, loadedRegister }

class AttendanceCubit extends Cubit<AttendanceState> {
  AttendanceCubit({required this.repository})
      : super(const AttendanceState());

  final AttendanceRepository repository;

  Future<void> loadSessions() async {
    emit(state.copyWith(
      status: AttendancePageStatus.loading,
      clearError: true,
    ));
    try {
      final sessions = await repository.listSessions();
      final selectedId =
          sessions.isNotEmpty ? sessions.first.id : null;
      emit(state.copyWith(
        status: AttendancePageStatus.loaded,
        sessions: sessions,
        selectedSessionId: selectedId,
      ));
      if (selectedId != null) await loadRegister(selectedId);
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: AttendancePageStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> loadRegister(String sessionId) async {
    emit(state.copyWith(
      status: AttendancePageStatus.loading,
      clearError: true,
      clearSuccess: true,
    ));
    try {
      final register = await repository.getRegister(sessionId);
      final marks = <String, String>{};
      for (final s in register.students) {
        marks[s.studentId] = s.status;
      }
      emit(state.copyWith(
        status: AttendancePageStatus.loadedRegister,
        selectedSessionId: sessionId,
        register: register,
        marks: marks,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: AttendancePageStatus.failure,
        error: e,
      ));
    }
  }

  void setMark(String studentId, String status) {
    final marks = Map<String, String>.from(state.marks);
    marks[studentId] = status;
    emit(state.copyWith(marks: marks));
  }

  void markAll(String status) {
    if (state.register == null) return;
    final marks = <String, String>{};
    for (final s in state.register!.students) {
      marks[s.studentId] = status;
    }
    emit(state.copyWith(marks: marks));
  }

  Future<void> save() async {
    if (state.register == null || state.selectedSessionId == null) return;
    emit(state.copyWith(saving: true, clearSaveError: true));
    try {
      // Find the most common status as default
      final counts = <String, int>{};
      for (final status in state.marks.values) {
        counts[status] = (counts[status] ?? 0) + 1;
      }
      var defaultStatus = 'PRESENT';
      var maxCount = 0;
      for (final entry in counts.entries) {
        if (entry.value > maxCount) {
          maxCount = entry.value;
          defaultStatus = entry.key;
        }
      }

      // Send only exceptions
      final exceptions = state.marks.entries
          .where((e) => e.value != defaultStatus)
          .map((e) => {'studentId': e.key, 'status': e.value})
          .toList();

      await repository.saveRegister(
        state.selectedSessionId!,
        defaultStatus: defaultStatus,
        exceptions: exceptions,
      );

      emit(state.copyWith(
        saving: false,
        savedAt: DateTime.now(),
        successMessage: 'Register saved.',
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        saving: false,
        saveError: e.message,
      ));
    }
  }
}
