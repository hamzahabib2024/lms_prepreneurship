/// Repository for rubrics — SRS §13.6, FR-TCH-021.
library;

import '../../../../core/network/api_client.dart';
import 'models/rubric_models.dart';

class RubricsRepository {
  const RubricsRepository(this._api);
  final ApiClient _api;

  Future<List<Rubric>> getRubrics() async {
    final result = await _api.get<Map<String, dynamic>>('/rubrics');
    return (result['rubrics'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Rubric.fromJson)
        .toList();
  }

  Future<Rubric> getRubric(String id) async {
    final result = await _api.get<Map<String, dynamic>>('/rubrics/$id');
    return Rubric.fromJson(result);
  }

  Future<Rubric> createRubric({
    required String title,
    required String type,
    required List<RubricCriterion> criteria,
  }) async {
    final body = {
      'title': title,
      'type': type,
      'criteria': criteria.map((c) => {
        'id': c.id,
        'description': c.description,
        'weight': c.weight,
        'levels': c.levels.map((l) => {
          'id': l.id,
          'label': l.label,
          'description': l.description,
          'marks': l.marks,
        }).toList(),
      }).toList(),
    };
    final result = await _api.post<Map<String, dynamic>>(
      '/rubrics',
      body,
    );
    return Rubric.fromJson(result);
  }

  Future<void> deleteRubric(String id) async {
    await _api.delete<dynamic>('/rubrics/$id');
  }
}
