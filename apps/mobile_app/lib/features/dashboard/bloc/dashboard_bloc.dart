import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/dashboard_repository.dart';

class DashboardBloc extends Bloc<DashboardEvent, DashboardState> {
  DashboardBloc({required DashboardRepository repository})
      : _repository = repository,
        super(const DashboardState.loading()) {
    on<DashboardLoadRequested>(_onLoad);
  }

  final DashboardRepository _repository;

  Future<void> _onLoad(DashboardLoadRequested event, Emitter<DashboardState> emit) async {
    emit(const DashboardState.loading());

    try {
      final data = await _repository.load();
      emit(DashboardState.loaded(data));
    } on ApiException catch (error) {
      emit(DashboardState.failure(error));
    }
  }
}

abstract class DashboardEvent extends Equatable {
  const DashboardEvent();

  @override
  List<Object?> get props => [];
}

class DashboardLoadRequested extends DashboardEvent {
  const DashboardLoadRequested();
}

enum DashboardStatus { loading, loaded, failure }

class DashboardState extends Equatable {
  const DashboardState({
    this.status = DashboardStatus.loading,
    this.data,
    this.error,
  });

  const DashboardState.loading() : this();

  const DashboardState.loaded(this.data)
      : status = DashboardStatus.loaded,
        error = null;

  const DashboardState.failure(this.error)
      : status = DashboardStatus.failure,
        data = null;

  final DashboardStatus status;
  final DashboardData? data;
  final ApiException? error;

  @override
  List<Object?> get props => [status, data, error];
}