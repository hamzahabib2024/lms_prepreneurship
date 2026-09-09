import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
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
  final ApiException? error;

  @override
  List<Object?> get props => [status, roster, saving, error];

  CompletionState copyWith({
    CompletionStatus? status,
    CompletionRoster? roster,
    bool? saving,
    ApiException? error,
    bool clearError = false,
  }) {
    return CompletionState(
      status: status ?? this.status,
      roster: roster ?? this.roster,
      saving: saving ?? this.saving,
      error: clearError ? null : (error ?? this.error),
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
    emit(state.copyWith(status: CompletionStatus.loading, clearError: true));
    try {
      final roster = await _repo.getRoster(sectionSubjectId);
      if (isClosed) return;
      emit(state.copyWith(
        status: CompletionStatus.loaded,
        roster: roster,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: CompletionStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> saveDecision({
    required String studentId,
    required String decision,
    String? note,
  }) async {
    if (_sectionSubjectId == null) return;

    emit(state.copyWith(saving: true, clearError: true));
    try {
      await _repo.saveDecision(
        sectionSubjectId: _sectionSubjectId!,
        studentId: studentId,
        decision: decision,
        note: note,
      );
      // Reload roster
      final roster = await _repo.getRoster(_sectionSubjectId!);
      if (isClosed) return;
      emit(state.copyWith(
        status: CompletionStatus.loaded,
        roster: roster,
        saving: false,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        saving: false,
        error: e,
      ));
    }
  }
}
