import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/learning_repository.dart';
import '../data/models/learning_models.dart';

class SubjectDetailState extends Equatable {
  const SubjectDetailState({
    this.status = SubjectDetailStatus.loading,
    this.progress,
    this.modules = const [],
    this.error,
  });

  final SubjectDetailStatus status;
  final SubjectDetailProgress? progress;
  final List<LearningModule> modules;
  final ApiException? error;

  SubjectDetailState copyWith({
    SubjectDetailStatus? status,
    SubjectDetailProgress? progress,
    List<LearningModule>? modules,
    ApiException? error,
    bool clearError = false,
  }) =>
      SubjectDetailState(
        status: status ?? this.status,
        progress: progress ?? this.progress,
        modules: modules ?? this.modules,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, progress, modules, error];
}

enum SubjectDetailStatus { loading, loaded, failure }

class SubjectDetailCubit extends Cubit<SubjectDetailState> {
  SubjectDetailCubit({required this.repository})
      : super(const SubjectDetailState());

  final LearningRepository repository;

  Future<void> load(String sectionSubjectId) async {
    emit(state.copyWith(status: SubjectDetailStatus.loading, clearError: true));
    try {
      final progress = await repository.subjectProgress(sectionSubjectId);
      final modules = await repository.subjectContent(progress.subjectId);
      emit(state.copyWith(
        status: SubjectDetailStatus.loaded,
        progress: progress,
        modules: modules,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: SubjectDetailStatus.failure,
        error: e,
      ));
    }
  }
}
