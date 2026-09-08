import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class BriefAttachment {
  const BriefAttachment({
    required this.id,
    required this.filename,
    required this.contentType,
    required this.sizeBytes,
  });

  final String id;
  final String filename;
  final String contentType;
  final int sizeBytes;

  factory BriefAttachment.fromJson(Map<String, dynamic> json) {
    return BriefAttachment(
      id: json['id'] as String? ?? '',
      filename: json['filename'] as String? ?? '',
      contentType: json['contentType'] as String? ?? '',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    );
  }

  String get formattedSize {
    if (sizeBytes < 1024) return '$sizeBytes B';
    if (sizeBytes < 1024 * 1024) return '${(sizeBytes / 1024).round()} KB';
    return '${(sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

class BriefAttachmentsCubit extends Cubit<BriefAttachmentsState> {
  BriefAttachmentsCubit({
    required this.api,
    required this.assignmentId,
  }) : super(const BriefAttachmentsState());

  final ApiClient api;
  final String assignmentId;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final items = await api.get<List<dynamic>>('/assignments/$assignmentId/attachments');
      if (isClosed) return;
      emit(state.copyWith(
        loading: false,
        files: items
            .whereType<Map<String, dynamic>>()
            .map(BriefAttachment.fromJson)
            .toList(),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, files: [], error: error));
    }
  }

  Future<void> upload(String filePath, String filename) async {
    emit(state.copyWith(uploading: true, error: null));
    try {
      final form = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: filename),
      });
      await api.uploadForm(
        '/assignments/$assignmentId/attachments',
        form,
      );
      if (isClosed) return;
      emit(state.copyWith(uploading: false));
      load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(uploading: false, error: error));
    }
  }

  Future<void> remove(String attachmentId) async {
    emit(state.copyWith(removingId: attachmentId, error: null));
    try {
      await api.delete('/assignment-attachments/$attachmentId');
      if (isClosed) return;
      emit(state.copyWith(removingId: null));
      load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(removingId: null, error: error));
    }
  }
}

class BriefAttachmentsState extends Equatable {
  const BriefAttachmentsState({
    this.loading = false,
    this.uploading = false,
    this.files,
    this.error,
    this.removingId,
  });

  final bool loading;
  final bool uploading;
  final List<BriefAttachment>? files;
  final ApiException? error;
  final String? removingId;

  BriefAttachmentsState copyWith({
    bool? loading,
    bool? uploading,
    List<BriefAttachment>? files,
    ApiException? error,
    String? removingId,
  }) {
    return BriefAttachmentsState(
      loading: loading ?? this.loading,
      uploading: uploading ?? this.uploading,
      files: files ?? this.files,
      error: error,
      removingId: removingId ?? this.removingId,
    );
  }

  @override
  List<Object?> get props => [loading, uploading, files, error, removingId];
}
