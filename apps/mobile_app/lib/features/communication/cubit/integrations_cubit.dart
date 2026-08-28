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
    this.outbox,
    this.loadingOutbox = false,
    this.outboxError,
  });

  final IntegrationsStatus status;
  final List<IntegrationStatus> items;
  final ApiException? error;
  final OutboxResult? outbox;
  final bool loadingOutbox;
  final ApiException? outboxError;

  IntegrationsState copyWith({
    IntegrationsStatus? status,
    List<IntegrationStatus>? items,
    ApiException? error,
    bool clearError = false,
    OutboxResult? outbox,
    bool clearOutbox = false,
    bool? loadingOutbox,
    ApiException? outboxError,
    bool clearOutboxError = false,
  }) =>
      IntegrationsState(
        status: status ?? this.status,
        items: items ?? this.items,
        error: clearError ? null : (error ?? this.error),
        outbox: clearOutbox ? null : (outbox ?? this.outbox),
        loadingOutbox: loadingOutbox ?? this.loadingOutbox,
        outboxError: clearOutboxError ? null : (outboxError ?? this.outboxError),
      );

  @override
  List<Object?> get props => [status, items, error, outbox, loadingOutbox, outboxError];
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

  Future<void> loadOutbox() async {
    emit(state.copyWith(loadingOutbox: true, clearOutboxError: true));
    try {
      final outbox = await repository.getOutbox();
      if (isClosed) return;
      emit(state.copyWith(outbox: outbox, loadingOutbox: false));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(loadingOutbox: false, outboxError: e));
    }
  }

  Future<void> clearOutbox() async {
    try {
      await repository.clearOutbox();
      if (isClosed) return;
      emit(state.copyWith(clearOutbox: true));
      await loadOutbox();
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(outboxError: e));
    }
  }
}
