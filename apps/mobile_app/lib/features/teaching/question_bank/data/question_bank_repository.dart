/// Question banks — SRS §9.8, FR-QIZ-004..012.
library;

import '../../../../core/network/api_client.dart';
import 'models/question_bank_models.dart';

class QuestionBankRepository {
  const QuestionBankRepository(this._api);

  final ApiClient _api;

  Future<List<QuestionBank>> banks({String? subjectId}) async {
    final path = subjectId == null
        ? '/question-banks'
        : '/question-banks?subjectId=${Uri.encodeQueryComponent(subjectId)}';
    final data = await _api.get<List<dynamic>>(path);
    return data
        .whereType<Map<String, dynamic>>()
        .map(QuestionBank.fromJson)
        .toList();
  }

  Future<QuestionBank> createBank({
    required String name,
    String? subjectId,
  }) async {
    final data = await _api.post<Map<String, dynamic>>('/question-banks', {
      'name': name.trim(),
      'subjectId': ?subjectId,
    });
    // The create response is the bank row itself, which has no count yet.
    return QuestionBank(
      id: data['id'] as String,
      name: data['name'] as String? ?? name.trim(),
      subjectId: data['subjectId'] as String?,
      questionCount: 0,
    );
  }

  /// With the answer key — `quiz_answer_key:read`, which no student holds.
  Future<List<BankQuestion>> questions(
    String bankId, {
    bool includeRetired = false,
  }) async {
    final data = await _api.get<List<dynamic>>(
      '/question-banks/$bankId/questions'
      '${includeRetired ? '?includeRetired=true' : ''}',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(BankQuestion.fromJson)
        .toList();
  }

  /// FR-QIZ-004..012. Nothing is validated here on purpose.
  ///
  /// The server decides whether a question is answerable and returns EVERY
  /// problem at once. A second copy of those rules on this side would drift,
  /// and the copy that drifts is the one people trust — because it answers
  /// faster.
  Future<BankQuestion> addQuestion(String bankId, QuestionDraft draft) async {
    final data = await _api.post<Map<String, dynamic>>(
      '/question-banks/$bankId/questions',
      draft.toJson(),
    );
    return BankQuestion.fromJson(data);
  }

  /// FR-QIZ-010 — retire, never delete: past attempts refer to it.
  Future<void> retire(String questionId) async {
    await _api.post<dynamic>('/questions/$questionId/retire');
  }
}
