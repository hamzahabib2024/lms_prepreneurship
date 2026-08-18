import 'dart:io';

/// The backend is shared with the web client (apps/api, global prefix
/// `api/v1`).
///
/// A PHYSICAL DEVICE cannot reach the emulator's special addresses, so the
/// base URL is a build-time override:
///
///   flutter run --dart-define=API_BASE_URL=http://your-pc-lan-ip:3000/api/v1
///
/// Defaults keep the simulators working out of the box: `10.0.2.2` is the
/// Android emulator's loopback to the host machine, and the iOS simulator and
/// desktop targets reach the host as plain `localhost`.
abstract final class AppConstants {
  static const _definedBaseUrl = String.fromEnvironment('API_BASE_URL');

  static String get apiBaseUrl {
    if (_definedBaseUrl.isNotEmpty) return _definedBaseUrl;
    if (Platform.isAndroid) {
      return 'http://10.0.2.2:3000/api/v1';
    }
    return 'http://localhost:3000/api/v1';
  }
}