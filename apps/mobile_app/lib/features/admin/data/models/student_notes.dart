import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../student_notes_repository.dart';

class StudentNote extends Equatable {
  const StudentNote({
    required this.id,
    required this.studentId,
    required this.body,
    required this.authorName,
    required this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String studentId;
  final String body;
  final String authorName;
  final DateTime createdAt;
  final DateTime? updatedAt;

  @override
  List<Object?> get props => [id, studentId, body, authorName, createdAt, updatedAt];
}

class StudentNotesState extends Equatable {
  const StudentNotesState({
    this.status = StudentNotesStatus.loading,
    this.notes = const [],
    this.error,
    this.saving = false,
  });

  final StudentNotesStatus status;
  final List<StudentNote> notes;
  final ApiException? error;
  final bool saving;

  StudentNotesState copyWith({
    StudentNotesStatus? status,
    List<StudentNote>? notes,
    ApiException? error,
    bool? saving,
    bool clearError = false,
  }) {
    return StudentNotesState(
      status: status ?? this.status,
      notes: notes ?? this.notes,
      error: clearError ? null : (error ?? this.error),
      saving: saving ?? this.saving,
    );
  }

  @override
  List<Object?> get props => [status, notes, error, saving];
}

enum StudentNotesStatus { loading, loaded, failure }

class StudentNotesCubit extends Cubit<StudentNotesState> {
  StudentNotesCubit(this._repo, {required this.studentId})
      : super(const StudentNotesState());

  final StudentNotesRepository _repo;
  final String studentId;

  Future<void> load() async {
    emit(state.copyWith(status: StudentNotesStatus.loading, clearError: true));
    try {
      final notes = await _repo.listNotes(studentId);
      emit(state.copyWith(
        status: StudentNotesStatus.loaded,
        notes: notes,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: StudentNotesStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> addNote({required String body}) async {
    if (body.trim().isEmpty) return;
    emit(state.copyWith(saving: true, clearError: true));
    try {
      await _repo.createNote(studentId: studentId, body: body.trim());
      emit(state.copyWith(saving: false));
      await load();
    } on ApiException catch (e) {
      emit(state.copyWith(saving: false, error: e));
    }
  }

  Future<void> updateNote({required String noteId, required String body}) async {
    if (body.trim().isEmpty) return;
    emit(state.copyWith(saving: true, clearError: true));
    try {
      await _repo.updateNote(noteId: noteId, body: body.trim());
      emit(state.copyWith(saving: false));
      await load();
    } on ApiException catch (e) {
      emit(state.copyWith(saving: false, error: e));
    }
  }

  Future<void> deleteNote({required String noteId}) async {
    emit(state.copyWith(saving: true, clearError: true));
    try {
      await _repo.deleteNote(noteId: noteId);
      emit(state.copyWith(saving: false));
      await load();
    } on ApiException catch (e) {
      emit(state.copyWith(saving: false, error: e));
    }
  }
}
