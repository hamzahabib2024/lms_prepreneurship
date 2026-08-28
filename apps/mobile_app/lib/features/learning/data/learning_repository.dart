import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import 'models/learning_models.dart';

/// Student learning endpoints — SRS §13.5, the mobile equivalent of the
/// web's My Subjects and Subject Detail pages.
class LearningRepository {
  LearningRepository({required this.api});

  final ApiClient api;

  /// GET /me/progress — every enrolled subject with progress and outstanding
  /// requirements. FR-PRG-007.
  Future<MyProgress> myProgress() async {
    final data = await api.get<Map<String, dynamic>>('/me/progress');
    return MyProgress.fromJson(data);
  }

  /// GET /me/progress/:sectionSubjectId — one subject's detailed progress
  /// with components, attendance and completion criteria.
  Future<SubjectDetailProgress> subjectProgress(String sectionSubjectId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/me/progress/$sectionSubjectId',
    );
    return SubjectDetailProgress.fromJson(data);
  }

  /// GET /subjects/:subjectId/content — module/lesson/lecture content tree.
  Future<List<LearningModule>> subjectContent(String subjectId) async {
    final data = await api.get<List<dynamic>>('/subjects/$subjectId/content');
    return data
        .whereType<Map<String, dynamic>>()
        .map(LearningModule.fromJson)
        .toList();
  }

  /// GET /lessons/:lessonId/resources — downloadable handouts for a lesson.
  Future<List<Handout>> lessonResources(String lessonId) async {
    final data = await api.get<List<dynamic>>('/lessons/$lessonId/resources');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Handout.fromJson)
        .toList();
  }

  /// Download a lesson resource — returns raw bytes.
  Future<List<int>> downloadResource(String resourceId) {
    return api.bytes('/lesson-resources/$resourceId/download');
  }

  // ------------------------------------------------------------- assignments ---

  /// GET /section-subjects/:id/my-assignments — student's assignments.
  Future<List<StudentAssignment>> myAssignments(String sectionSubjectId) async {
    final data = await api.get<List<dynamic>>(
      '/section-subjects/$sectionSubjectId/my-assignments',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(StudentAssignment.fromJson)
        .toList();
  }

  /// GET /assignments/:id/files — pending files for an assignment.
  Future<List<PendingFile>> assignmentFiles(String assignmentId) async {
    final data = await api.get<List<dynamic>>('/assignments/$assignmentId/files');
    return data
        .whereType<Map<String, dynamic>>()
        .map(PendingFile.fromJson)
        .toList();
  }

  /// Upload a file to an assignment.
  Future<PendingFile> uploadAssignmentFile({
    required String assignmentId,
    required String filePath,
    required String fileName,
  }) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath, filename: fileName),
    });
    final data = await api.uploadForm<Map<String, dynamic>>(
      '/assignments/$assignmentId/files',
      form,
    );
    return PendingFile.fromJson(data);
  }

  /// Remove a pending file from an assignment.
  Future<void> removeAssignmentFile(String fileId) {
    return api.delete<void>('/submission-files/$fileId');
  }

  /// Submit an assignment.
  Future<SubmissionResult> submitAssignment({
    required String assignmentId,
    String? textResponse,
    List<String>? fileIds,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/assignments/$assignmentId/submissions',
      {
        if (textResponse != null && textResponse.isNotEmpty)
          'textResponse': textResponse,
        'fileIds': fileIds ?? [],
      },
    );
    return SubmissionResult.fromJson(data);
  }

  /// Download brief audio for an assignment.
  Future<List<int>> downloadBriefAudio(String assignmentId) {
    return api.bytes('/assignments/$assignmentId/brief-audio');
  }

  /// Download feedback audio for a submission.
  Future<List<int>> downloadFeedbackAudio(String submissionId) {
    return api.bytes('/submissions/$submissionId/feedback-audio');
  }
}
