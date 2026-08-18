import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// A scripted HTTP layer so the ApiClient can be exercised without a server.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this._responses);

  final List<Future<ResponseBody> Function(RequestOptions)> _responses;
  int _calls = 0;

  /// Every request that went out, for asserting paths and payloads.
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    if (_calls >= _responses.length) {
      throw StateError('unexpected request ${options.method} ${options.uri}');
    }
    final next = _responses[_calls++];
    return next(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody jsonResponse(int status, Map<String, dynamic> body) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

ResponseBody bytesResponse(List<int> bytes) {
  return ResponseBody.fromBytes(bytes, 200, headers: {
    Headers.contentTypeHeader: ['image/jpeg'],
  });
}