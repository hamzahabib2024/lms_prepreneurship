import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class InboxState extends Equatable {
  const InboxState({
    this.status = InboxStatus.loading,
    this.items = const [],
    this.unread = 0,
    this.error,
  });

  final InboxStatus status;
  final List<NotificationItem> items;
  final int unread;
  final ApiException? error;

  InboxState copyWith({
    InboxStatus? status,
    List<NotificationItem>? items,
    int? unread,
    ApiException? error,
    bool clearError = false,
  }) =>
      InboxState(
        status: status ?? this.status,
        items: items ?? this.items,
        unread: unread ?? this.unread,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, items, unread, error];
}

enum InboxStatus { loading, loaded, failure }

class InboxCubit extends Cubit<InboxState> {
  InboxCubit({required this.repository}) : super(const InboxState());

  final CommunicationRepository repository;

  Future<void> load() async {
    emit(state.copyWith(clearError: true));
    try {
      final result = await repository.inbox();
      emit(state.copyWith(
        status: InboxStatus.loaded,
        items: result.items,
        unread: result.unread,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: InboxStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> markRead(List<String> ids) async {
    try {
      await repository.markRead(ids);
      await load();
    } on ApiException {
      // Silently fail — the inbox is not why anyone is here.
    }
  }

  Future<void> markAllRead() async {
    try {
      await repository.markAllRead();
      await load();
    } on ApiException {
      // Silently fail.
    }
  }
}
