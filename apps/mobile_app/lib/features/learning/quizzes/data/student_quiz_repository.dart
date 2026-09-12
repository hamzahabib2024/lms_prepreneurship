/// Sitting a quiz — SRS §9.8, FR-QIZ-023..028.
///
/// The web client's QuizPanel talks to exactly these five endpoints, and this
/// is the same conversation from the phone. Note what is NOT here: nothing
/// scores anything, and nothing decides whether time has run out. Both are
/// the server's, and a client that took either on would be a client that
/// could be edited into a better mark.
library;

import '../../../../core/network/api_client.dart';
import 'models/student_quiz_models.dart';

class StudentQuizRepository {
  const StudentQuizRepository(this._api);

  final ApiClient _api;

  /// FR-QIZ-023 — the quizzes set for one subject, with this student's
  /// standing on each. Carries no question data: browsing is not attempting.
  Future<List<StudentQuiz>> myQuizzes(String sectionSubjectId) async {
    final data = await _api.get<List<dynamic>>(
      '/section-subjects/$sectionSubjectId/my-quizzes',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(StudentQuiz.fromJson)
        .toList();
  }

  /// FR-QIZ-024 — start, or resume one already open.
  ///
  /// One endpoint for both because the student does not know which it is:
  /// they press the same button either way, and the server decides based on
  /// what it has recorded.
  Future<QuizAttempt> startOrResume(String quizId) async {
    final data = await _api.post<Map<String, dynamic>>(
      '/quizzes/$quizId/attempts',
    );
    return QuizAttempt.fromJson(data);
  }

  /// FR-QIZ-026 — save one answer as it is given.
  ///
  /// [response] is the shape for the question's type: `{selectedOptionIds:
  /// [...]}` for the choice types, `{text: "…"}` for the written ones,
  /// `{value: n}` for numeric, or null to clear it.
  Future<void> saveAnswer({
    required String attemptId,
    required String questionId,
    required Map<String, dynamic>? response,
  }) async {
    await _api.patch<dynamic>('/attempts/$attemptId/answers', {
      'questionId': questionId,
      'response': response,
    });
  }

  /// FR-QIZ-027/028 — close the attempt.
  ///
  /// Called both when the student presses Submit and when the displayed clock
  /// reaches zero. The second is a courtesy, not a mechanism: an attempt left
  /// open is finalised by the server regardless of whether this app is still
  /// running.
  Future<AttemptOutcome> submit(String attemptId) async {
    final data = await _api.post<Map<String, dynamic>>(
      '/attempts/$attemptId/submit',
    );
    return AttemptOutcome.fromJson(data);
  }

  /// FR-QIZ-021/022 — the marked paper, if the release and answer-review
  /// policies allow it. The server returns what may be shown and no more.
  Future<Map<String, dynamic>> attemptResult(String attemptId) {
    return _api.get<Map<String, dynamic>>('/attempts/$attemptId/result');
  }
}
