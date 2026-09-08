import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class CohortImportPreviewRow {
  const CohortImportPreviewRow({
    required this.row,
    required this.name,
    this.email,
    this.phone,
    this.error,
    this.status = '',
  });

  final int row;
  final String name;
  final String? email;
  final String? phone;
  final String? error;
  final String status;

  factory CohortImportPreviewRow.fromJson(Map<String, dynamic> json) {
    return CohortImportPreviewRow(
      row: (json['row'] as num?)?.toInt() ?? 0,
      name: json['name'] as String? ?? '',
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      error: json['error'] as String?,
      status: json['status'] as String? ?? '',
    );
  }
}

class CohortImportPreview {
  const CohortImportPreview({
    required this.rows,
    required this.wouldLoad,
    required this.wouldRejoin,
    this.fileProblem,
    this.message = '',
  });

  final List<CohortImportPreviewRow> rows;
  final int wouldLoad;
  final int wouldRejoin;
  final String? fileProblem;
  final String message;

  factory CohortImportPreview.fromJson(Map<String, dynamic> json) {
    return CohortImportPreview(
      rows: (json['rows'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CohortImportPreviewRow.fromJson)
          .toList(),
      wouldLoad: (json['wouldLoad'] as num?)?.toInt() ?? 0,
      wouldRejoin: (json['wouldRejoin'] as num?)?.toInt() ?? 0,
      fileProblem: json['fileProblem'] as String?,
      message: json['message'] as String? ?? '',
    );
  }
}

class CohortImportResult {
  const CohortImportResult({
    required this.loaded,
    required this.rejoined,
    this.message = '',
  });

  final int loaded;
  final int rejoined;
  final String message;

  factory CohortImportResult.fromJson(Map<String, dynamic> json) {
    return CohortImportResult(
      loaded: (json['loaded'] as num?)?.toInt() ?? 0,
      rejoined: (json['rejoined'] as num?)?.toInt() ?? 0,
      message: json['message'] as String? ?? '',
    );
  }
}

class CohortImportCubit extends Cubit<CohortImportState> {
  CohortImportCubit({required this.api}) : super(const CohortImportState());

  final ApiClient api;

  Future<void> preview({
    required String sectionId,
    required String csv,
    String? partnerInstituteId,
  }) async {
    emit(state.copyWith(previewing: true, error: null, preview: null));
    try {
      final json = await api.post<Map<String, dynamic>>('/cohort-import/preview', {
        'sectionId': sectionId,
        'csv': csv,
        if (partnerInstituteId != null && partnerInstituteId.isNotEmpty)
          'partnerInstituteId': partnerInstituteId,
      });
      if (isClosed) return;
      emit(state.copyWith(
        previewing: false,
        preview: CohortImportPreview.fromJson(json),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(previewing: false, error: error));
    }
  }

  Future<void> commit({
    required String sectionId,
    required String csv,
    required String note,
    String? partnerInstituteId,
  }) async {
    emit(state.copyWith(committing: true, error: null));
    try {
      final json = await api.post<Map<String, dynamic>>('/cohort-import/commit', {
        'sectionId': sectionId,
        'csv': csv,
        'note': note,
        if (partnerInstituteId != null && partnerInstituteId.isNotEmpty)
          'partnerInstituteId': partnerInstituteId,
      });
      if (isClosed) return;
      emit(state.copyWith(
        committing: false,
        result: CohortImportResult.fromJson(json),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(committing: false, error: error));
    }
  }
}

class CohortImportState extends Equatable {
  const CohortImportState({
    this.previewing = false,
    this.committing = false,
    this.preview,
    this.result,
    this.error,
  });

  final bool previewing;
  final bool committing;
  final CohortImportPreview? preview;
  final CohortImportResult? result;
  final ApiException? error;

  CohortImportState copyWith({
    bool? previewing,
    bool? committing,
    CohortImportPreview? preview,
    CohortImportResult? result,
    ApiException? error,
  }) {
    return CohortImportState(
      previewing: previewing ?? this.previewing,
      committing: committing ?? this.committing,
      preview: preview ?? this.preview,
      result: result ?? this.result,
      error: error,
    );
  }

  @override
  List<Object?> get props => [previewing, committing, preview, result, error];
}
