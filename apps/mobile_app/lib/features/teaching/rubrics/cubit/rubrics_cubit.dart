import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
  final String? error;

  @override
  List<Object?> get props => [status, rubrics, selectedRubric, error];

  RubricsState copyWith({
    RubricsStatus? status,
    List<Rubric>? rubrics,
    Rubric? selectedRubric,
    String? error,
  }) {
    return RubricsState(
      status: status ?? this.status,
      rubrics: rubrics ?? this.rubrics,
      selectedRubric: selectedRubric ?? this.selectedRubric,
      error: error ?? this.error,
    );
  }
}

enum RubricsStatus { initial, loading, loaded, failure }

class RubricsCubit extends Cubit<RubricsState> {
  RubricsCubit(this._repo) : super(const RubricsState());
  final RubricsRepository _repo;

  Future<void> loadRubrics() async {
    emit(state.copyWith(status: RubricsStatus.loading));
    try {
      final rubrics = await _repo.getRubrics();
      emit(state.copyWith(
        status: RubricsStatus.loaded,
        rubrics: rubrics,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: 'Failed to load rubrics: $e',
      ));
    }
  }

  Future<void> loadRubric(String id) async {
    emit(state.copyWith(status: RubricsStatus.loading));
    try {
      final rubric = await _repo.getRubric(id);
      emit(state.copyWith(
        status: RubricsStatus.loaded,
        selectedRubric: rubric,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: 'Failed to load rubric: $e',
      ));
    }
  }

  Future<void> createRubric({
    required String title,
    required String type,
    required List<RubricCriterion> criteria,
  }) async {
    emit(state.copyWith(status: RubricsStatus.loading));
    try {
      await _repo.createRubric(title: title, type: type, criteria: criteria);
      await loadRubrics();
    } catch (e) {
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: 'Failed to create rubric: $e',
      ));
    }
  }

  Future<void> deleteRubric(String id) async {
    emit(state.copyWith(status: RubricsStatus.loading));
    try {
      await _repo.deleteRubric(id);
      await loadRubrics();
    } catch (e) {
      emit(state.copyWith(
        status: RubricsStatus.failure,
        error: 'Failed to delete rubric: $e',
      ));
    }
  }
}
