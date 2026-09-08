import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class LectureUploadCubit extends Cubit<LectureUploadState> {
  LectureUploadCubit({required this.api}) : super(const LectureUploadState());

  final ApiClient api;

  Future<void> uploadLecture({
    required String sectionSubjectId,
    required String title,
    required String filename,
    required List<int> fileBytes,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      final formData = FormData.fromMap({
        'file': MultipartFile.fromBytes(fileBytes, filename: filename),
        'title': title,
        'sectionSubjectId': sectionSubjectId,
      });
      await api.uploadForm<dynamic>('/lectures/upload', formData);
      if (isClosed) return;
      emit(state.copyWith(busy: false, success: 'Recording uploaded'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, error: error));
    }
  }

  void dismissResult() {
    emit(state.copyWith(clearSuccess: true, clearError: true));
  }
}

class LectureUploadState {
  const LectureUploadState({
    this.busy = false,
    this.error,
    this.success,
  });

  final bool busy;
  final ApiException? error;
  final String? success;

  LectureUploadState copyWith({
    bool? busy,
    ApiException? error,
    String? success,
    bool clearSuccess = false,
    bool clearError = false,
  }) {
    return LectureUploadState(
      busy: busy ?? this.busy,
      error: clearError ? null : (error ?? this.error),
      success: clearSuccess ? null : (success ?? this.success),
    );
  }
}

class LectureUploadSheet extends StatefulWidget {
  const LectureUploadSheet({
    super.key,
    required this.api,
    required this.sectionSubjectId,
  });

  final ApiClient api;
  final String sectionSubjectId;

  @override
  State<LectureUploadSheet> createState() => _LectureUploadSheetState();
}

class _LectureUploadSheetState extends State<LectureUploadSheet> {
  final _titleController = TextEditingController();
  String? _filename;
  List<int>? _fileBytes;

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LectureUploadCubit(api: widget.api),
      child: Builder(
        builder: (context) {
          return Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              0,
              20,
              MediaQuery.of(context).viewInsets.bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Upload a recording',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _titleController,
                    decoration: const InputDecoration(labelText: 'Title'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () async {
                      // In a real implementation, this would open file picker
                      setState(() {
                        _filename = 'recording.mp4';
                        _fileBytes = [0]; // placeholder
                      });
                    },
                    icon: const Icon(Icons.attach_file, size: 18),
                    label: Text(_filename ?? 'Choose file'),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: BlocConsumer<LectureUploadCubit, LectureUploadState>(
                          listenWhen: (prev, curr) =>
                              prev.success != curr.success ||
                              prev.error != curr.error,
                          listener: (context, state) {
                            if (state.success != null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(state.success!)),
                              );
                              Navigator.of(context).pop();
                            }
                            if (state.error != null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(state.error!.message)),
                              );
                            }
                          },
                          builder: (context, state) {
                            return FilledButton(
                              onPressed: (state.busy ||
                                      _titleController.text.trim().isEmpty ||
                                      _fileBytes == null)
                                  ? null
                                  : () {
                                      context.read<LectureUploadCubit>().uploadLecture(
                                            sectionSubjectId: widget.sectionSubjectId,
                                            title: _titleController.text.trim(),
                                            filename: _filename ?? 'recording.mp4',
                                            fileBytes: _fileBytes!,
                                          );
                                    },
                              child: state.busy
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    )
                                  : const Text('Upload'),
                            );
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Cancel'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
