import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'api_client.dart';

/// Saving a file the API will only hand over with a session.
///
/// The web makes a blob URL and clicks an invisible anchor; a phone has no
/// such thing, so the bytes are written to the app's documents directory and
/// the path is handed back for the caller to show or open.
///
/// FETCHED, NOT LINKED, for the same reason everywhere else in this app: a
/// receipt and a teacher's brief are both behind a bearer token (SEC-FIL-009),
/// so there is no URL that could simply be opened.
abstract final class FileDownload {
  /// Downloads [path] and writes it under a safe version of [filename].
  ///
  /// Returns the file on disk. Throws [ApiException] from the client, which
  /// the caller is expected to render — a failed download is worth a sentence
  /// and not a crash.
  static Future<File> save(
    ApiClient api, {
    required String path,
    required String filename,
  }) async {
    final bytes = await api.bytes(path);
    final dir = await getApplicationDocumentsDirectory();
    final file = File('${dir.path}/${safeName(filename)}');
    await file.writeAsBytes(bytes);
    return file;
  }

  /// A filename that cannot escape the directory it is written into.
  ///
  /// The name comes from the server, which got it from whoever uploaded the
  /// file. Separators and parent references are replaced rather than
  /// stripped, so two files whose names differ only in a slash do not collide
  /// into one.
  static String safeName(String filename) {
    final cleaned = filename
        .replaceAll(RegExp(r'[/\\]'), '_')
        .replaceAll(RegExp(r'^\.+'), '_')
        .trim();
    return cleaned.isEmpty ? 'download' : cleaned;
  }
}
