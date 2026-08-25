import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/cohort_import_repository.dart';
import '../data/models/cohort_import_models.dart';

// ── Events / State ──

enum CohortImportStep { pickFile, preview, result }

class CohortImportState extends Equatable {
  const CohortImportState({
    this.step = CohortImportStep.pickFile,
    this.sections = const [],
    this.sectionId = '',
    this.csv = '',
    this.fileName = '',
    this.preview,
    this.result,
    this.note = '',
    this.consent = false,
    this.capacityOverride = false,
    this.loading = false,
    this.error,
  });

  final CohortImportStep step;
  final List<CohortSection> sections;
  final String sectionId;
  final String csv;
  final String fileName;
  final ImportPreview? preview;
  final ImportResult? result;
  final String note;
  final bool consent;
  final bool capacityOverride;
  final bool loading;
  final String? error;

  bool get canPreview => csv.isNotEmpty && sectionId.isNotEmpty && !loading;
  bool get canCommit =>
      preview != null &&
      preview!.fileProblem == null &&
      (preview!.wouldLoad + preview!.wouldRejoin) > 0 &&
      consent &&
      note.length >= 10 &&
      !loading;

  CohortImportState copyWith({
    CohortImportStep? step,
    List<CohortSection>? sections,
    String? sectionId,
    String? csv,
    String? fileName,
    ImportPreview? preview,
    ImportResult? result,
    String? note,
    bool? consent,
    bool? capacityOverride,
    bool? loading,
    String? error,
    bool clearPreview = false,
    bool clearResult = false,
    bool clearError = false,
  }) {
    return CohortImportState(
      step: step ?? this.step,
      sections: sections ?? this.sections,
      sectionId: sectionId ?? this.sectionId,
      csv: csv ?? this.csv,
      fileName: fileName ?? this.fileName,
      preview: clearResult ? null : (clearPreview ? null : (preview ?? this.preview)),
      result: clearResult ? null : (result ?? this.result),
      note: note ?? this.note,
      consent: consent ?? this.consent,
      capacityOverride: capacityOverride ?? this.capacityOverride,
      loading: loading ?? this.loading,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  List<Object?> get props => [
        step,
        sections,
        sectionId,
        csv,
        fileName,
        preview,
        result,
        note,
        consent,
        capacityOverride,
        loading,
        error,
      ];
}

// ── Cubit ──

class CohortImportCubit extends Cubit<CohortImportState> {
  CohortImportCubit(this._repo) : super(const CohortImportState());

  final CohortImportRepository _repo;

  /// Load sections on init.
  Future<void> init() async {
    try {
      final sections = await _repo.getSections();
      emit(state.copyWith(sections: sections));
    } catch (e) {
      emit(state.copyWith(error: 'Failed to load sections: $e'));
    }
  }

  void setSectionId(String id) {
    final changed = id != state.sectionId;
    emit(state.copyWith(
      sectionId: id,
      clearPreview: changed,
      clearResult: changed,
    ));
  }

  void setCsv(String csv, String fileName) {
    final changed = csv != state.csv;
    emit(state.copyWith(
      csv: csv,
      fileName: fileName,
      clearPreview: changed,
      clearResult: changed,
    ));
  }

  void setNote(String note) => emit(state.copyWith(note: note));
  void setConsent(bool v) => emit(state.copyWith(consent: v));
  void setCapacityOverride(bool v) => emit(state.copyWith(capacityOverride: v));
  void clearError() => emit(state.copyWith(clearError: true));

  /// Run the preview.
  Future<void> runPreview() async {
    if (!state.canPreview) return;
    emit(state.copyWith(loading: true, clearError: true));
    try {
      final preview = await _repo.preview(
        csv: state.csv,
        sectionId: state.sectionId,
      );
      emit(state.copyWith(
        loading: false,
        preview: preview,
        step: CohortImportStep.preview,
      ));
    } catch (e) {
      emit(state.copyWith(loading: false, error: 'Preview failed: $e'));
    }
  }

  /// Commit the import.
  Future<void> runCommit() async {
    if (!state.canCommit) return;
    emit(state.copyWith(loading: true, clearError: true));
    try {
      final result = await _repo.commit(
        csv: state.csv,
        sectionId: state.sectionId,
        capacityOverride: state.capacityOverride,
        note: state.note,
      );
      emit(state.copyWith(
        loading: false,
        result: result,
        step: CohortImportStep.result,
      ));
    } catch (e) {
      emit(state.copyWith(loading: false, error: 'Import failed: $e'));
    }
  }

  /// Reset everything to start a new import.
  void reset() {
    emit(CohortImportState(sections: state.sections));
  }
}
