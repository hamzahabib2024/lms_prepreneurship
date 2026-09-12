import '../../../core/network/api_client.dart';
import 'models/public_page_models.dart';
import 'models/showcase.dart';

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

  /// GET /public/showcase — the front page, for people with no account.
  ///
  /// Public on purpose: this is the one route in the System hit by visitors
  /// who have never signed in, so it goes over the unauthenticated client and
  /// never carries a token.
  Future<Showcase> getShowcase() async {
    final map = await _api.getPublic<Map<String, dynamic>>('/public/showcase');
    return Showcase.fromJson(map);
  }
}
