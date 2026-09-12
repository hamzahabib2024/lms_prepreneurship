/// Composing a quiz's paper — SRS §9.8, FR-QIZ-014..020.
library;

import '../../../../core/network/api_client.dart';
import 'models/quiz_paper_models.dart';

class QuizPaperRepository {
  const QuizPaperRepository(this._api);

  final ApiClient _api;

  Future<QuizPaper> detail(String quizId) async {
    final data = await _api.get<Map<String, dynamic>>('/quizzes/$quizId/detail');
    return QuizPaper.fromJson(data);
  }

  /// [marks] overrides the question's default for this paper only.
  Future<void> addQuestion({
    required String quizId,
    required String questionId,
    double? marks,
  }) async {
    await _api.post<dynamic>('/quizzes/$quizId/questions', {
      'questionId': questionId,
      'marks': ?marks,
    });
  }

  Future<void> removeQuestion({
    required String quizId,
    required String questionId,
  }) async {
    await _api.delete<dynamic>('/quizzes/$quizId/questions/$questionId');
  }

  /// FR-QIZ-020 — the server refuses an incoherent paper here rather than
  /// letting a cohort discover it mid-attempt.
  Future<void> publish(String quizId) async {
    await _api.post<dynamic>('/quizzes/$quizId/publish');
  }
}
