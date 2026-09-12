/// Repository for marking, grading and quiz marking — SRS §13.6, FR-TCH-018/019.
library;

import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import 'models/marking_models.dart';

class MarkingRepository {
  const MarkingRepository(this._api);
  final ApiClient _api;

  // ── Marking Queue (teacher's sections & assignments) ──

  /// The classes this teacher marks for.
  ///
  /// From the dashboard's own mySections widget, which is where the web reads
  /// it: the server already computes "what am I assigned to" for the home
  /// screen, and a second endpoint answering the same question is a second
  /// place for the scope rule to be wrong.
  Future<List<TeacherSection>> getTeacherSections() async {
    final result = await _api.get<Map<String, dynamic>>('/dashboards/me');
    final widgets = (result['widgets'] as Map<String, dynamic>?) ?? const {};
    return (widgets['mySections'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(TeacherSection.fromJson)
        .toList();
  }

  /// FR-TCH-018 — the assignments set for one class.
  ///
  /// `submission_roster` on the server, not `assignment:read`: the counts on
  /// each row are cohort figures, and a student must not reach them.
  Future<List<TeacherAssignment>> getAssignmentQueue(
      {required String sectionSubjectId}) async {
    final result = await _api.get<List<dynamic>>(
      '/section-subjects/$sectionSubjectId/assignments',
    );
    return result
        .whereType<Map<String, dynamic>>()
        .map(TeacherAssignment.fromJson)
        .toList();
  }

  /// FR-TCH-018 — the quizzes set for one class, drafts included.
  Future<List<TeacherQuiz>> getQuizQueue(
      {required String sectionSubjectId}) async {
    final result = await _api.get<List<dynamic>>(
      '/section-subjects/$sectionSubjectId/quizzes',
    );
    return result
        .whereType<Map<String, dynamic>>()
        .map(TeacherQuiz.fromJson)
        .toList();
  }

  // ── Grading (per-assignment roster + grade/release) ──

  /// FR-TCH-019 — submitted, not submitted, late, ungraded, at a glance.
  Future<GradingRoster> getGradingRoster(
      {required String assignmentId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/assignments/$assignmentId/submissions',
    );
    return GradingRoster.fromJson(result);
  }

  /// KEYED BY SUBMISSION, not by student and assignment.
  ///
  /// A mark is a mark on a piece of work: a resubmission is a new submission
  /// and the roster carries its id for exactly this call. There is nothing to
  /// grade for a student who has not submitted, which is why the roster's
  /// submissionId is nullable and this takes a non-null one.
  Future<void> gradeSubmission({
    required String submissionId,
    required num rawMarks,
    Map<String, num>? rubricScores,
    String? feedback,
    String? internalNotes,
    String? revisionReason,
  }) async {
    await _api.post<dynamic>(
      '/submissions/$submissionId/grade',
      <String, dynamic>{
        'rawMarks': rawMarks,
        'rubricScores': ?rubricScores,
        'feedback': ?feedback,
        'internalNotes': ?internalNotes,
        // BR-ASG-11 — a released grade cannot be changed without a reason.
        'revisionReason': ?revisionReason,
      },
    );
  }

  /// FR-ASG-028 — release the cohort together, so nobody sees a mark first.
  Future<void> releaseGrades({required String assignmentId}) async {
    await _api.post<dynamic>(
      '/assignments/$assignmentId/release-grades',
    );
  }

  // ── Quiz Marking ──

  /// FR-QIZ-031 — the written answers waiting on a human.
  Future<MarkingQueue> getMarkingQueue({required String quizId}) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/quizzes/$quizId/marking',
    );
    return MarkingQueue.fromJson(result);
  }

  /// FR-QIZ-031 — marks for one written answer.
  ///
  /// `quiz_answer_grade`, not `quiz_attempt`. A student holds
  /// quiz_attempt:update so they can save answers while sitting the quiz;
  /// that must never be the permission deciding what an answer is worth.
  Future<void> saveQuizMark({
    required String answerId,
    required num marksAwarded,
    String? graderComment,
  }) async {
    await _api.post<dynamic>(
      '/quiz-answers/$answerId/grade',
      <String, dynamic>{
        'marks': marksAwarded,
        'comment': ?graderComment,
      },
    );
  }

  /// FR-QIZ-021 — release every fully-marked attempt together, so nobody
  /// learns their score before their classmates.
  Future<void> releaseQuizGrades({required String quizId}) async {
    await _api.post<dynamic>(
      '/quizzes/$quizId/release-results',
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

  // ── Submission Comments ──

  Future<List<SubmissionComment>> getSubmissionComments({
    required String submissionId,
    String? fileId,
  }) async {
    var url = '/submissions/$submissionId/comments';
    if (fileId != null) url += '?fileId=$fileId';
    final result = await _api.get<Map<String, dynamic>>(url);
    return (result['comments'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(SubmissionComment.fromJson)
        .toList();
  }

  Future<SubmissionComment> postComment({
    required String submissionId,
    required String body,
    String? fileId,
  }) async {
    final payload = <String, dynamic>{'body': body};
    if (fileId != null) payload['fileId'] = fileId;
    final result = await _api.post<Map<String, dynamic>>(
      '/submissions/$submissionId/comments',
      payload,
    );
    return SubmissionComment.fromJson(result);
  }

  Future<SubmissionComment> editComment({
    required String submissionId,
    required String commentId,
    required String body,
  }) async {
    final result = await _api.put<Map<String, dynamic>>(
      '/submission-comments/$commentId',
      {'body': body},
    );
    return SubmissionComment.fromJson(result);
  }

  Future<void> withdrawComment({
    required String submissionId,
    required String commentId,
  }) async {
    await _api.delete<dynamic>(
      '/submission-comments/$commentId',
    );
  }
}
