/// Repository for the quiz builder — SRS §13.6, FR-TCH-022.
library;

import '../../../../core/network/api_client.dart';
import 'models/quiz_builder_models.dart';

class QuizBuilderRepository {
  const QuizBuilderRepository(this._api);
  final ApiClient _api;

  Future<List<QuizSummary>> getQuizzes(String sectionSubjectId) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/quizzes?sectionSubjectId=$sectionSubjectId',
    );
    return (result['/quizzes'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(QuizSummary.fromJson)
        .toList();
  }

  /// Returns the id of the quiz that was created, which is the only thing
  /// the caller needs: the next step is composing its paper.
  Future<String> createQuiz(QuizDraft draft) async {
    final result = await _api.post<Map<String, dynamic>>(
      '/quizzes',
      draft.toJson(),
    );
    return result['id'] as String;
  }

  Future<QuizDraft> updateQuiz(QuizDraft draft) async {
    final result = await _api.put<Map<String, dynamic>>(
      '/quizzes/${draft.id}',
      draft.toJson(),
    );
    return QuizDraft(
      id: result['id'] as String?,
      title: result['title'] as String? ?? '',
      sectionSubjectId: result['sectionSubjectId'] as String? ?? '',
      totalMarks: (result['totalMarks'] as num?)?.toInt() ?? 0,
      opensAt: result['opensAt'] as String? ?? '',
      closesAt: result['closesAt'] as String? ?? '',
      durationMinutes: (result['durationMinutes'] as num?)?.toInt() ?? 0,
      publicationStatus: result['publicationStatus'] as String? ?? 'DRAFT',
      questions: const [],
    );
  }

  Future<void> publishQuiz(String id) async {
    await _api.post<dynamic>('/quizzes/$id/publish');
  }

  Future<void> deleteQuiz(String id) async {
    await _api.delete<dynamic>('/quizzes/$id');
  }
}
