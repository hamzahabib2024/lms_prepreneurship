import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/rubrics_repository.dart';
import '../data/models/rubric_models.dart';

class RubricsState extends Equatable {
  const RubricsState({
    this.status = RubricsStatus.initial,
    this.rubrics = const [],
    this.selectedRubric,
    this.error,
  });

  final RubricsStatus status;
  final List<Rubric> rubrics;
  final Rubric? selectedRubric;
  final ApiException? error;

  @override
  List<Object?> get props => [status, rubrics, selectedRubric, error];

  RubricsState copyWith({
    RubricsStatus? status,
    List<Rubric>? rubrics,
    Rubric? selectedRubric,
    ApiException? error,
    bool clearError = false,
  }) {
    return RubricsState(
      status: status ?? this.status,
      rubrics: rubrics ?? this.rubrics,
      selectedRubric: selectedRubric ?? this.selectedRubric,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

enum RubricsStatus { initial, loading, loaded, failure }

class RubricsCubit extends Cubit<RubricsState> {
  RubricsCubit(this._repo) : super(const RubricsState());
  final RubricsRepository _repo;

  Future<void> loadRubrics() async {
    emit(state.copyWith(status: RubricsStatus.loading, clearError: true));
    try {
      final rubrics = await _repo.getRubrics();
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.loaded,
        rubrics: rubrics,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> loadRubric(String id) async {
    emit(state.copyWith(status: RubricsStatus.loading, clearError: true));
    try {
      final rubric = await _repo.getRubric(id);
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.loaded,
        selectedRubric: rubric,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> createRubric({
    required String title,
    required String type,
    required List<RubricCriterion> criteria,
  }) async {
    emit(state.copyWith(status: RubricsStatus.loading, clearError: true));
    try {
      await _repo.createRubric(title: title, type: type, criteria: criteria);
      await loadRubrics();
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> deleteRubric(String id) async {
    emit(state.copyWith(status: RubricsStatus.loading, clearError: true));
    try {
      await _repo.deleteRubric(id);
      await loadRubrics();
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: e,
      ));
    }
  }
}
