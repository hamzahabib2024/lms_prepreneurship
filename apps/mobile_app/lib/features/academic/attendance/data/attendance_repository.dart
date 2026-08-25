import '../../../../core/network/api_client.dart';
import 'models/attendance_models.dart';

/// Attendance management endpoints — SRS §5.11, §13.6, UC-15.
class AttendanceRepository {
  AttendanceRepository({required this.api});

  final ApiClient api;

  /// GET /live-sessions?days=7&pastDays=30 — sessions the teacher may mark.
  Future<List<AttendanceSession>> listSessions() async {
    final data = await api.get<List<dynamic>>(
      '/live-sessions?days=7&pastDays=30',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(AttendanceSession.fromJson)
        .toList();
  }

  /// GET /live-sessions/:id/attendance — the register for one session.
  Future<Register> getRegister(String sessionId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/live-sessions/$sessionId/attendance',
    );
    return Register.fromJson(data);
  }

  /// POST /live-sessions/:id/attendance — save the register.
  Future<AttendanceSaveResult> saveRegister(
    String sessionId, {
    required String defaultStatus,
    required List<Map<String, String>> exceptions,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/live-sessions/$sessionId/attendance',
      {
        'defaultStatus': defaultStatus,
        'exceptions': exceptions,
      },
    );
    return AttendanceSaveResult.fromJson(data);
  }
}
