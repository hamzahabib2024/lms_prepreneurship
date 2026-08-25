import '../../../core/network/api_client.dart';
import 'models/cohort_import_models.dart';

class CohortImportRepository {
  CohortImportRepository(this._api);
  final ApiClient _api;

  /// GET /sections – list all sections for the picker.
  Future<List<CohortSection>> getSections() async {
    final list = await _api.get<List<dynamic>>('/sections');
    return list
        .map((e) => CohortSection.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /admin/cohort-import/preview – dry-run validation.
  Future<ImportPreview> preview({
    required String csv,
    required String sectionId,
  }) async {
    final map = await _api.post<Map<String, dynamic>>(
      '/admin/cohort-import/preview',
      <String, dynamic>{'csv': csv, 'sectionId': sectionId},
    );
    return ImportPreview.fromJson(map);
  }

  /// POST /admin/cohort-import – commit the import.
  Future<ImportResult> commit({
    required String csv,
    required String sectionId,
    required bool capacityOverride,
    required String note,
  }) async {
    final map = await _api.post<Map<String, dynamic>>(
      '/admin/cohort-import',
      <String, dynamic>{
        'csv': csv,
        'sectionId': sectionId,
        'capacityOverride': capacityOverride,
        'consentCollectedOffline': true,
        'note': note,
      },
    );
    return ImportResult.fromJson(map);
  }
}
