import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/email_queue_repository.dart';
import '../data/models/email_queue_item.dart';
import '../data/models/email_queue_summary.dart';
import '../data/models/email_queue_usage.dart';

class EmailQueueCubit extends Cubit<EmailQueueState> {
  EmailQueueCubit({required this.repository}) : super(const EmailQueueState());

  final EmailQueueRepository repository;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final summary = await repository.getQueue();
      if (isClosed) return;
      emit(state.copyWith(loading: false, summary: summary));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  Future<void> approveAll() async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null, actionSuccess: null));
    try {
      final result = await repository.approve(ids: []);
      if (isClosed) return;
      final count = result['released'] as int? ?? 0;
      emit(state.copyWith(
        busy: false,
        actionSuccess: '$count released. They will go out within ten minutes.',
      ));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> approveSelected(List<String> ids) async {
    if (state.busy || ids.isEmpty) return;
    emit(state.copyWith(busy: true, actionError: null, actionSuccess: null));
    try {
      final result = await repository.approve(ids: ids);
      if (isClosed) return;
      final count = result['released'] as int? ?? 0;
      emit(state.copyWith(
        busy: false,
        actionSuccess: '$count released. They will go out within ten minutes.',
        selectedIds: {},
      ));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> discardSelected(List<String> ids) async {
    if (state.busy || ids.isEmpty) return;
    emit(state.copyWith(busy: true, actionError: null, actionSuccess: null));
    try {
      final result = await repository.discard(ids: ids);
      if (isClosed) return;
      final count = result['discarded'] as int? ?? 0;
      emit(state.copyWith(
        busy: false,
        actionSuccess: '$count discarded.',
        selectedIds: {},
      ));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void toggleSelection(String id) {
    final current = Set<String>.from(state.selectedIds);
    if (current.contains(id)) {
      current.remove(id);
    } else {
      current.add(id);
    }
    emit(state.copyWith(selectedIds: current));
  }

  void selectAll(List<String> ids) {
    emit(state.copyWith(selectedIds: Set<String>.from(ids)));
  }

  void clearSelection() {
    emit(state.copyWith(selectedIds: {}));
  }

  void dismissResult() {
    emit(state.copyWith(clearActionSuccess: true, clearActionError: true));
  }
}

class EmailQueueState extends Equatable {
  const EmailQueueState({
    this.loading = false,
    this.summary,
    this.error,
    this.busy = false,
    this.actionError,
    this.actionSuccess,
    this.selectedIds = const {},
  });

  final bool loading;
  final EmailQueueSummary? summary;
  final ApiException? error;
  final bool busy;
  final ApiException? actionError;
  final String? actionSuccess;
  final Set<String> selectedIds;

  List<EmailQueueItem> get waiting =>
      summary?.rows.where((r) => r.status == 'AWAITING_APPROVAL').toList() ?? [];

  List<EmailQueueItem> get retrying =>
      summary?.rows.where((r) => r.status == 'PENDING').toList() ?? [];

  List<EmailQueueItem> get abandoned =>
      summary?.rows.where((r) => r.status == 'ABANDONED').toList() ?? [];

  EmailQueueState copyWith({
    bool? loading,
    EmailQueueSummary? summary,
    ApiException? error,
    bool? busy,
    ApiException? actionError,
    String? actionSuccess,
    bool clearActionSuccess = false,
    bool clearActionError = false,
    Set<String>? selectedIds,
  }) {
    return EmailQueueState(
      loading: loading ?? this.loading,
      summary: summary ?? this.summary,
      error: error,
      busy: busy ?? this.busy,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      actionSuccess: clearActionSuccess ? null : (actionSuccess ?? this.actionSuccess),
      selectedIds: selectedIds ?? this.selectedIds,
    );
  }

  @override
  List<Object?> get props => [
        loading,
        summary,
        error,
        busy,
        actionError,
        actionSuccess,
        selectedIds,
      ];
}
