import 'package:shared_preferences/shared_preferences.dart';

/// Token storage — the same policy the web client documents in
/// apps/web/src/api/client.ts:
///
/// * The access token lives in memory only, so it dies with the process and
///   is never readable from disk.
/// * The refresh token goes to persisted preferences, a deliberate and
///   documented trade-off: SEC-SES-002 would prefer a device-secure store,
///   but the API returns tokens in the body, and moving to a hidden store is
///   a server change rather than a client one.
class TokenStore {
  TokenStore._();

  static final TokenStore instance = TokenStore._();

  static const String refreshKey = 'lms.refresh';

  SharedPreferences? _prefs;

  /// The access token, held in memory only.
  String? accessToken;

  /// Must be called once before the app makes its first authenticated call.
  Future<void> init() async {
    _prefs ??= await SharedPreferences.getInstance();
  }

  String? get refreshToken => _prefs?.getString(refreshKey);

  void setRefreshToken(String? token) {
    final prefs = _prefs;
    if (prefs == null) return;
    if (token == null || token.isEmpty) {
      prefs.remove(refreshKey);
    } else {
      prefs.setString(refreshKey, token);
    }
  }

  /// Called when refresh fails, wiping the session so the app returns to
  /// sign-in — the mobile equivalent of the web's `tokens.clear()`.
  void clear() {
    accessToken = null;
    final prefs = _prefs;
    if (prefs != null) prefs.remove(refreshKey);
  }
}