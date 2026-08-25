import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/completion_repository.dart';
import '../data/models/completion_models.dart';

class CompletionState extends Equatable {
  const CompletionState({
    this.status = CompletionStatus.initial,
    this.roster,
    this.saving = false,
    this.error,
  });

  final CompletionStatus status;
  final CompletionRoster? roster;
  final bool saving;
  final String? error;

  @override
  List<Object?> get props => [status, roster, saving, error];

  CompletionState copyWith({
    CompletionStatus? status,
    CompletionRoster? roster,
    bool? saving,
    String? error,
  }) {
    return CompletionState(
      status: status ?? this.status,
      roster: roster ?? this.roster,
      saving: saving ?? this.saving,
      error: error ?? this.error,
    );
  }
}

enum CompletionStatus { initial, loading, loaded, failure }

class CompletionCubit extends Cubit<CompletionState> {
  CompletionCubit(this._repo) : super(const CompletionState());
  final CompletionRepository _repo;
  String? _sectionSubjectId;

  Future<void> load(String sectionSubjectId) async {
    _sectionSubjectId = sectionSubjectId;
    emit(state.copyWith(status: CompletionStatus.loading));
    try {
      final roster = await _repo.getRoster(sectionSubjectId);
      emit(state.copyWith(
        status: CompletionStatus.loaded,
        roster: roster,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: CompletionStatus.failure,
        error: 'Failed to load roster: $e',
      ));
    }
  }

  Future<void> saveDecision({
    required String studentId,
    required String decision,
    String? note,
  }) async {
    if (_sectionSubjectId == null) return;

    emit(state.copyWith(saving: true));
    try {
      await _repo.saveDecision(
        sectionSubjectId: _sectionSubjectId!,
        studentId: studentId,
        decision: decision,
        note: note,
      );
      // Reload roster
      final roster = await _repo.getRoster(_sectionSubjectId!);
      emit(state.copyWith(
        status: CompletionStatus.loaded,
        roster: roster,
        saving: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        saving: false,
        error: 'Failed to save: $e',
      ));
    }
  }
}
