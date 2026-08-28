/// Repository for marking, grading and quiz marking — SRS §13.6, FR-TCH-018/019.
library;

import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import 'models/marking_models.dart';

class MarkingRepository {
  const MarkingRepository(this._api);
  final ApiClient _api;

  // ── Marking Queue (teacher's sections & assignments) ──

  Future<List<TeacherSection>> getTeacherSections() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/marking/sections',
    );
    return (result['sections'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(TeacherSection.fromJson)
        .toList();
  }

  Future<List<TeacherAssignment>> getAssignmentQueue(
      {required String sectionSubjectId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/marking/assignments?sectionSubjectId=$sectionSubjectId',
    );
    return (result['assignments'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(TeacherAssignment.fromJson)
        .toList();
  }

  Future<List<TeacherQuiz>> getQuizQueue(
      {required String sectionSubjectId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/marking/quizzes?sectionSubjectId=$sectionSubjectId',
    );
    return (result['quizzes'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(TeacherQuiz.fromJson)
        .toList();
  }

  // ── Grading (per-assignment roster + grade/release) ──

  Future<GradingRoster> getGradingRoster(
      {required String assignmentId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/assignments/$assignmentId/roster',
    );
    return GradingRoster.fromJson(result);
  }

  Future<void> gradeStudent({
    required String assignmentId,
    required String studentId,
    required num rawMarks,
    num? penaltyApplied,
    String? feedback,
    String? internalNotes,
  }) async {
    final body = <String, dynamic>{
      'rawMarks': rawMarks,
    };
    if (penaltyApplied != null) body['penaltyApplied'] = penaltyApplied;
    if (feedback != null) body['feedback'] = feedback;
    if (internalNotes != null) body['internalNotes'] = internalNotes;

    await _api.post<dynamic>(
      '/assignments/$assignmentId/grade/$studentId',
      body,
    );
  }

  Future<void> releaseGrades({required String assignmentId}) async {
    await _api.post<dynamic>(
      '/assignments/$assignmentId/release',
    );
  }

  // ── Quiz Marking ──

  Future<MarkingQueue> getMarkingQueue({required String quizId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/quizzes/$quizId/marking-queue',
    );
    return MarkingQueue.fromJson(result);
  }

  Future<void> saveQuizMark({
    required String answerId,
    required num marksAwarded,
    String? graderComment,
  }) async {
    final body = <String, dynamic>{
      'marksAwarded': marksAwarded,
    };
    if (graderComment != null) body['graderComment'] = graderComment;

    await _api.post<dynamic>(
      '/quizzes/answers/$answerId/mark',
      body,
    );
  }

  Future<void> releaseQuizGrades({required String quizId}) async {
    await _api.post<dynamic>(
      '/quizzes/$quizId/release',
    );
  }

  /// Upload voice feedback for a student's submission.
  Future<void> uploadFeedbackAudio({
    required String submissionId,
    required String filePath,
    required String fileName,
  }) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(filePath, filename: fileName),
    });
    await _api.uploadForm<void>(
      '/submissions/$submissionId/feedback-audio',
      form,
    );
  }
}
