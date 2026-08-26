import '../../../core/network/api_client.dart';
import 'models/public_page_models.dart';

class PublicPageRepository {
  PublicPageRepository(this._api);
  final ApiClient _api;

  /// GET /public-page – full editor document.
  Future<PublicDocument> getDocument() async {
    final map = await _api.get<Map<String, dynamic>>('/public-page');
    return PublicDocument.fromJson(map);
  }

  /// PUT /public-page – save batch of field changes.
  /// Values set to null mean "restore default" (delete override).
  Future<SaveResult> save(Map<String, dynamic> values) async {
    final map = await _api.put<Map<String, dynamic>>(
      '/public-page',
      <String, dynamic>{'values': values},
    );
    return SaveResult.fromJson(map);
  }
}
