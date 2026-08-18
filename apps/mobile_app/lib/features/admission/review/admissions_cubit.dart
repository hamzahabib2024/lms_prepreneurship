import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/admission_repository.dart';
import '../data/models/application_detail.dart';
import '../data/models/approval_result.dart';
import '../data/models/queue_item.dart';
import '../data/models/section_summary.dart';

/// The admission review workflow — SRS §13.5, FR-REG-022..046.
///
/// One cubit owns the queue and the selected application, so a reviewer never
/// loses their place, and after a decision the next application is selected
/// automatically — admissions are processed in batches at intake (FR-REG-037).
class AdmissionsCubit extends Cubit<AdmissionsState> {
  AdmissionsCubit({required this.repository}) : super(const AdmissionsState.initial());

  final AdmissionRepository repository;

  Future<void> loadQueue() async {
    if (state.loadingQueue) return;
    emit(state.copyWith(loadingQueue: true, queueError: null));
    try {
      final rows = await repository.queue();
      if (isClosed) return;
      emit(state.copyWith(queue: rows, loadingQueue: false));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingQueue: false, queueError: error));
    }
  }

  /// FR-REG-025 — the application with its slips, fetched on selection.
  Future<void> select(String id) async {
    if (state.selectedId == id && state.detail != null) return;
    emit(state.copyWith(
      selectedId: id,
      clearDetail: true,
      clearReceipt: true,
    ));
    try {
      final detail = await repository.detail(id);
      final sections = state.sections.isEmpty ? await repository.sections() : state.sections;
      if (isClosed) return;
      emit(state.copyWith(detail: detail, sections: sections));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(detailError: error));
    }
  }

  /// FR-REG-039 — verify payment and provision, atomically.
  Future<void> approve({
    required String id,
    required num verifiedAmount,
    required DateTime paymentDate,
    required String method,
    String? bankReference,
    String? varianceReason,
    required String sectionId,
    bool capacityOverride = false,
    String? note,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.approve(
        id: id,
        verifiedAmount: verifiedAmount,
        paymentDate: paymentDate,
        method: method,
        bankReference: bankReference,
        varianceReason: varianceReason,
        sectionId: sectionId,
        capacityOverride: capacityOverride,
        note: note,
      );
      if (isClosed) return;
      emit(state.copyWith(
        busy: false,
        receipt: result,
        clearDetail: true,
        clearSelected: true,
      ));
      await loadQueue();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  /// FR-REG-033/034/046.
  Future<void> reject({required String id, required String reasonCode, String? note}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.reject(id: id, reasonCode: reasonCode, note: note);
      if (isClosed) return;
      emit(state.copyWith(
        busy: false,
        clearDetail: true,
        clearSelected: true,
      ));
      await loadQueue();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void dismissReceipt() {
    if (state.receipt == null) return;
    emit(state.copyWith(clearReceipt: true));
  }
}

enum AdmissionsStatus { initial, loading, ready, failure }

class AdmissionsState extends Equatable {
  const AdmissionsState({
    this.queue = const [],
    this.sections = const [],
    this.selectedId,
    this.detail,
    this.receipt,
    this.loadingQueue = false,
    this.busy = false,
    this.queueError,
    this.detailError,
    this.actionError,
  });

  const AdmissionsState.initial()
      : queue = const [],
        sections = const [],
        selectedId = null,
        detail = null,
        receipt = null,
        loadingQueue = false,
        busy = false,
        queueError = null,
        detailError = null,
        actionError = null;

  final List<QueueItem> queue;
  final List<SectionSummary> sections;
  final String? selectedId;
  final ApplicationDetail? detail;
  final ApprovalResult? receipt;
  final bool loadingQueue;
  final bool busy;
  final ApiException? queueError;
  final ApiException? detailError;
  final ApiException? actionError;

  AdmissionsState copyWith({
    List<QueueItem>? queue,
    List<SectionSummary>? sections,
    String? selectedId,
    ApplicationDetail? detail,
    ApprovalResult? receipt,
    bool? loadingQueue,
    bool? busy,
    ApiException? queueError,
    ApiException? detailError,
    ApiException? actionError,
    bool clearSelected = false,
    bool clearDetail = false,
    bool clearReceipt = false,
  }) {
    return AdmissionsState(
      queue: queue ?? this.queue,
      sections: sections ?? this.sections,
      selectedId: clearSelected ? null : (selectedId ?? this.selectedId),
      detail: clearDetail ? null : (detail ?? this.detail),
      receipt: clearReceipt ? null : (receipt ?? this.receipt),
      loadingQueue: loadingQueue ?? this.loadingQueue,
      busy: busy ?? this.busy,
      queueError: queueError,
      detailError: detailError,
      actionError: actionError,
    );
  }

  @override
  List<Object?> get props => [
        queue, sections, selectedId, detail, receipt, loadingQueue, busy,
        queueError, detailError, actionError,
      ];
}
