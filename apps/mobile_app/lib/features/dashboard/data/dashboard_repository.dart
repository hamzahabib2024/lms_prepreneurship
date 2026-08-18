import '../../../core/network/api_client.dart';

/// GET /dashboards/me — the same endpoint the web dashboard uses. The server
/// decides which widgets this user gets (FR-DSH-002), so the client renders
/// whatever it is given rather than branching on role. That keeps the
/// authorisation decision in one place: a client that chose its own widgets
/// would be a second, weaker copy of the permission matrix.
class DashboardRepository {
  DashboardRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<DashboardData> load() async {
    final json = await _api.get<Map<String, dynamic>>('/dashboards/me');
    return DashboardData(
      role: json['role'] as String? ?? '',
      generatedAt:
          DateTime.tryParse(json['generatedAt'] as String? ?? '') ?? DateTime.now(),
      // Widget values vary: some are objects, some (mySections) are arrays —
      // the client renders whichever shape the server chose (FR-DSH-002).
      widgets: json['widgets'] as Map<String, dynamic>? ?? const {},
    );
  }
}

class DashboardData {
  const DashboardData({
    required this.role,
    required this.generatedAt,
    required this.widgets,
  });

  final String role;
  final DateTime generatedAt;
  final Map<String, dynamic> widgets;
}