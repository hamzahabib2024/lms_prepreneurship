import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/learning_repository.dart';
import '../data/models/learning_models.dart';

class MySubjectsState extends Equatable {
  const MySubjectsState({
    this.status = MySubjectsStatus.loading,
    this.progress,
    this.error,
  });

  final MySubjectsStatus status;
  final MyProgress? progress;
  final ApiException? error;

  MySubjectsState copyWith({
    MySubjectsStatus? status,
    MyProgress? progress,
    ApiException? error,
    bool clearError = false,
  }) =>
      MySubjectsState(
        status: status ?? this.status,
        progress: progress ?? this.progress,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, progress, error];
}

enum MySubjectsStatus { loading, loaded, failure }

class MySubjectsCubit extends Cubit<MySubjectsState> {
  MySubjectsCubit({required this.repository}) : super(const MySubjectsState());

  final LearningRepository repository;

  Future<void> load() async {
    emit(state.copyWith(status: MySubjectsStatus.loading, clearError: true));
    try {
      final progress = await repository.myProgress();
      emit(state.copyWith(
        status: MySubjectsStatus.loaded,
        progress: progress,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: MySubjectsStatus.failure,
        error: e,
      ));
    }
  }
}
