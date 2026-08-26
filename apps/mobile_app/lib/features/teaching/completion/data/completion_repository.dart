/// Repository for completion tracking — SRS §13.6, FR-TCH-023.
library;

import '../../../../core/network/api_client.dart';
import 'models/completion_models.dart';

class CompletionRepository {
  const CompletionRepository(this._api);
  final ApiClient _api;

  Future<CompletionRoster> getRoster(String sectionSubjectId) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/completion',
    );
    return CompletionRoster.fromJson(result);
  }

  Future<void> saveDecision({
    required String sectionSubjectId,
    required String studentId,
    required String decision,
    String? note,
  }) async {
    final body = <String, dynamic>{
      'decision': decision,
    };
    if (note != null) body['note'] = note;

    await _api.put<dynamic>(
      '/section-subjects/$sectionSubjectId/completion/$studentId',
      body,
    );
  }
}
