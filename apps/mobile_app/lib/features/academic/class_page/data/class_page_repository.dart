/// Repository for the class page — SRS §5.11, UC-15.
library;

import '../../../../core/network/api_client.dart';
import 'models/class_page_models.dart';

class ClassPageRepository {
  const ClassPageRepository(this._api);
  final ApiClient _api;

  Future<JoinRoute> getJoinRoute(String sessionId) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/live-sessions/$sessionId/join-route',
    );
    return JoinRoute.fromJson(result);
  }

  Future<void> checkIn(String sessionId) async {
    await _api.post<dynamic>(
      '/live-sessions/$sessionId/check-in',
    );
  }
}
