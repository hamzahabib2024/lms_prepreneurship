import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/admission_repository.dart';
import '../data/models/application_draft.dart';
import '../data/models/prospectus.dart';
import '../data/models/submission_result.dart';

/// The public application flow — SRS §13.2, FR-REG-001..019.
///
/// Owns the remote state (the prospectus, the uploaded slips, the submission).
/// The form fields themselves live in the page, exactly as the web form keeps
/// them in local state — a field change is not an event worth shipping through
/// a state machine.
class ApplicationCubit extends Cubit<ApplicationState> {
  ApplicationCubit({required this.repository}) : super(const ApplicationState.initial());

  final AdmissionRepository repository;

  Future<void> start() async {
    if (state.status == ApplicationStatus.loading) return;
    emit(const ApplicationState.loading());
    try {
      final programmes = await repository.prospectus();
      if (isClosed) return;
      emit(ApplicationState.ready(programmes: programmes));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(ApplicationState.failure(error: error));
    }
  }

  /// FR-REG-008 — one slip at a time, up to five. Uploaded immediately: the
  /// application names slip ids, so they must exist first.
  Future<void> uploadSlip({required String filename, required List<int> bytes}) async {
    if (state.uploading) return;
    emit(state.copyWith(uploading: true, error: null));
    try {
      final id = await repository.uploadSlip(filename: filename, bytes: bytes);
      if (isClosed) return;
      final ids = [...state.documentIds];
      if (!ids.contains(id)) ids.add(id);
      emit(state.copyWith(documentIds: ids, uploading: false));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(uploading: false, error: error));
    } catch (_) {
      if (isClosed) return;
      emit(state.copyWith(
        uploading: false,
        error: const ApiException(status: 0, message: 'That file could not be uploaded.'),
      ));
    }
  }

  void removeSlip(String id) {
    emit(state.copyWith(documentIds: [...state.documentIds]..remove(id)));
  }

  /// FR-REG-018 — the only call that creates anything.
  Future<void> submit(ApplicationDraft draft) async {
    if (state.submitting) return;
    emit(state.copyWith(submitting: true, error: null));
    try {
      // The slips the reviewer will see are the ones that were actually
      // uploaded — the draft must carry exactly what the cubit holds.
      draft.documentIds
        ..clear()
        ..addAll(state.documentIds);
      final result = await repository.submit(draft);
      if (isClosed) return;
      emit(ApplicationState.submitted(result: result));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(submitting: false, error: error));
    }
  }

  void clearError() {
    if (state.error == null) return;
    emit(state.copyWith(error: null));
  }
}

enum ApplicationStatus { initial, loading, ready, submitted, failure }

class ApplicationState extends Equatable {
  const ApplicationState({
    required this.status,
    this.programmes = const [],
    this.documentIds = const [],
    this.uploading = false,
    this.submitting = false,
    this.error,
    this.result,
  });

  const ApplicationState.initial()
      : status = ApplicationStatus.initial,
        programmes = const [],
        documentIds = const [],
        uploading = false,
        submitting = false,
        error = null,
        result = null;

  const ApplicationState.loading()
      : status = ApplicationStatus.loading,
        programmes = const [],
        documentIds = const [],
        uploading = false,
        submitting = false,
        error = null,
        result = null;

  const ApplicationState.ready({required this.programmes})
      : status = ApplicationStatus.ready,
        uploading = false,
        submitting = false,
        documentIds = const [],
        error = null,
        result = null;

  const ApplicationState.submitted({required this.result})
      : status = ApplicationStatus.submitted,
        programmes = const [],
        documentIds = const [],
        uploading = false,
        submitting = false,
        error = null;

  const ApplicationState.failure({required this.error})
      : status = ApplicationStatus.failure,
        programmes = const [],
        documentIds = const [],
        uploading = false,
        submitting = false,
        result = null;

  final ApplicationStatus status;
  final List<ProspectusProgramme> programmes;
  final List<String> documentIds;
  final bool uploading;
  final bool submitting;
  final ApiException? error;
  final SubmissionResult? result;

  ApplicationState copyWith({
    List<String>? documentIds,
    bool? uploading,
    bool? submitting,
    ApiException? error,
    SubmissionResult? result,
  }) {
    return ApplicationState(
      status: status,
      programmes: programmes,
      documentIds: documentIds ?? this.documentIds,
      uploading: uploading ?? this.uploading,
      submitting: submitting ?? this.submitting,
      error: error,
      result: result ?? this.result,
    );
  }

  @override
  List<Object?> get props =>
      [status, programmes, documentIds, uploading, submitting, error, result];
}
