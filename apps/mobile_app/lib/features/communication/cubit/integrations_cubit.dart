import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class IntegrationsState extends Equatable {
  const IntegrationsState({
    this.status = IntegrationsStatus.loading,
    this.items = const [],
    this.error,
  });

  final IntegrationsStatus status;
  final List<IntegrationStatus> items;
  final ApiException? error;

  IntegrationsState copyWith({
    IntegrationsStatus? status,
    List<IntegrationStatus>? items,
    ApiException? error,
    bool clearError = false,
  }) =>
      IntegrationsState(
        status: status ?? this.status,
        items: items ?? this.items,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, items, error];
}

enum IntegrationsStatus { loading, loaded, failure }

class IntegrationsCubit extends Cubit<IntegrationsState> {
  IntegrationsCubit({required this.repository})
      : super(const IntegrationsState());

  final CommunicationRepository repository;

  Future<void> load() async {
    emit(state.copyWith(
      status: IntegrationsStatus.loading,
      clearError: true,
    ));
    try {
      final items = await repository.integrationStatuses();
      emit(state.copyWith(
        status: IntegrationsStatus.loaded,
        items: items,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: IntegrationsStatus.failure,
        error: e,
      ));
    }
  }
}
