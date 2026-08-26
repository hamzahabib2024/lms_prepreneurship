import '../../../core/network/api_client.dart';
import 'models/template_models.dart';

class TemplateRepository {
  TemplateRepository(this._api);
  final ApiClient _api;

  /// GET /notification-templates – list all templates.
  Future<List<NotificationTemplate>> getAll() async {
    final list = await _api.get<List<dynamic>>('/notification-templates');
    return list
        .map((e) => NotificationTemplate.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// PUT /notification-templates/:kind – save custom title and body.
  Future<void> save({
    required String kind,
    required String title,
    required String body,
  }) async {
    await _api.put<dynamic>(
      '/notification-templates/$kind',
      <String, dynamic>{'title': title, 'body': body},
    );
  }

  /// DELETE /notification-templates/:kind – reset to system default.
  Future<void> reset(String kind) async {
    await _api.delete<dynamic>('/notification-templates/$kind');
  }
}
