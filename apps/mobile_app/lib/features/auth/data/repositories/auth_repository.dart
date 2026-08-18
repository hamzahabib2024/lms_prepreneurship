import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../models/auth_session.dart';

/// Talks to the same /auth/* endpoints the web client uses — the backend is
/// shared, so there is no mobile-specific auth path.
class AuthRepository {
  AuthRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<AuthSession> login({required String email, required String password}) {
    return _api
        .post<Map<String, dynamic>>('/auth/login', {
          'email': email.trim(),
          'password': password,
          'deviceLabel': 'mobile-app',
        })
        .then(AuthSession.fromJson);
  }

  /// Restores the session that the refresh token describes. The access token
  /// lives in memory only, so a cold start always begins without one; the
  /// server decides whether the refresh token is still valid (SEC-SES-007).
  ///
  /// `mustChangePassword` arrives beside the user, not inside it — a forced
  /// change (FR-REG-040) must survive an app restart, not only hold right
  /// after login.
  Future<MeResult> me() async {
    final json = await _api.get<Map<String, dynamic>>('/auth/me');
    return MeResult(
      user: AuthUser.fromMe(json),
      mustChangePassword: json['mustChangePassword'] as bool? ?? false,
    );
  }

  /// Best effort: SEC-SES-004 wants the session ended server-side (it uses
  /// the session id in the access token), but a network failure must not
  /// leave the user stuck in the app.
  Future<void> logout() async {
    try {
      await _api.post<void>('/auth/logout');
    } on ApiException {
      // Best effort — the local session is cleared regardless.
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.post<void>('/auth/password/change', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
  }
}

class MeResult {
  const MeResult({required this.user, required this.mustChangePassword});

  final AuthUser user;
  final bool mustChangePassword;
}