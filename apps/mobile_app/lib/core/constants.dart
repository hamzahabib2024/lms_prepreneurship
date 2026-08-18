import 'dart:io';

/// The backend is shared with the web client (apps/api, global prefix
/// `api/v1`).
///
/// `10.0.2.2` is the Android emulator's loopback to the host machine; the iOS
/// simulator and desktop targets reach the host as plain `localhost`.
/// A physical device needs the development machine's LAN address here instead.
abstract final class AppConstants {
  static String get apiBaseUrl {
    if (Platform.isAndroid) {
      return 'http://10.0.2.2:3000/api/v1';
    }
    return 'http://localhost:3000/api/v1';
  }
}