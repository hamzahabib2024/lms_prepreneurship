import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/api_client.dart';
import 'package:mobile_app/core/network/api_exception.dart';
import 'package:mobile_app/core/network/token_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A scripted HTTP layer so the ApiClient can be exercised without a server.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._responses);

  final List<Future<ResponseBody> Function(RequestOptions)> _responses;
  int _calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    expect(_calls, lessThan(_responses.length),
        reason: 'unexpected request ${options.method} ${options.path}');
    return _responses[_calls++](options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Map<String, dynamic> body) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late TokenStore store;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    store = TokenStore.instance;
    await store.init();
  });

  group('ApiClient envelope', () {
    test('unwraps the { data, meta } envelope', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
        ..httpClientAdapter = _FakeAdapter([
          (o) => Future.value(_json(200, {
                'data': {'accessToken': 'abc'},
                'meta': {'requestId': 'r1'},
              })),
        ]);
      final client = ApiClient(tokenStore: store, dio: dio);

      final data = await client.get<Map<String, dynamic>>('/me');
      expect(data['accessToken'], 'abc');
    });

    test('parses the { error, meta } failure envelope including reference', () async {
      final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
        ..httpClientAdapter = _FakeAdapter([
          (o) => Future.value(_json(401, {
                'error': {
                  'code': 'AUTH_INVALID_CREDENTIALS',
                  'message': 'The email address or password is incorrect.',
                  'reference': 'ERR-AB12CD34',
                },
                'meta': {'requestId': 'r1'},
              })),
        ]);
      final client = ApiClient(tokenStore: store, dio: dio);

      await expectLater(
        client.get<void>('/auth/login'),
        throwsA(isA<ApiException>()
            .having((e) => e.code, 'code', 'AUTH_INVALID_CREDENTIALS')
            .having((e) => e.reference, 'reference', 'ERR-AB12CD34')),
      );
    });

    test('refreshes once on AUTH_TOKEN_EXPIRED and replays the request', () async {
      store.accessToken = 'stale';
      store.setRefreshToken('stale-refresh');
      final accesses = <String?>[];
      final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
        ..httpClientAdapter = _FakeAdapter([
          // First attempt: expired access token.
          (o) {
            accesses.add(o.headers['Authorization'] as String?);
            return Future.value(_json(401, {
              'error': {'code': 'AUTH_TOKEN_EXPIRED', 'message': 'expired'},
              'meta': {'requestId': 'r1'},
            }));
          },
          // The refresh call.
          (o) {
            expect(o.data, contains('refreshToken'));
            return Future.value(_json(200, {
              'data': {
                'accessToken': 'fresh-access',
                'refreshToken': 'rotated-refresh',
              },
              'meta': {'requestId': 'r2'},
            }));
          },
          // The replayed request with the fresh token.
          (o) {
            accesses.add(o.headers['Authorization'] as String?);
            return Future.value(_json(200, {
              'data': {'ok': true},
              'meta': {'requestId': 'r3'},
            }));
          },
        ]);
      final client = ApiClient(tokenStore: store, dio: dio);
      var unauthenticated = false;
      client.onUnauthenticated = () => unauthenticated = true;

      final result = await client.get<Map<String, dynamic>>('/dashboards/me');

      expect(result['ok'], true);
      expect(accesses, ['Bearer stale', 'Bearer fresh-access']);
      expect(store.accessToken, 'fresh-access');
      expect(store.refreshToken, 'rotated-refresh');
      expect(unauthenticated, false);
    });

    test('player does not see a consumed refresh token: single flight', () async {
      store.accessToken = 'stale';
      store.setRefreshToken('stale-refresh');
      final dio = Dio(BaseOptions(baseUrl: 'http://test/v1'))
        ..httpClientAdapter = _FakeAdapter([
          (o) => Future.value(_json(401, {
                'error': {'code': 'AUTH_TOKEN_EXPIRED', 'message': 'expired'},
                'meta': {'requestId': 'r1'},
              })),
          (o) => Future.value(_json(401, {
                'error': {'code': 'AUTH_TOKEN_EXPIRED', 'message': 'expired'},
                'meta': {'requestId': 'r2'},
              })),
          (o) => Future.value(_json(200, {
                'data': {
                  'accessToken': 'fresh-access',
                  'refreshToken': 'rotated-refresh',
                },
                'meta': {'requestId': 'r3'},
              })),
          (o) => Future.value(_json(200, {'data': {'ok': true}, 'meta': {}})),
          (o) => Future.value(_json(200, {'data': {'ok': true}, 'meta': {}})),
        ]);
      final client = ApiClient(tokenStore: store, dio: dio);

      // Two parallel requests both hit a 401; only ONE refresh may fire, or
      // the second would present a consumed token and revoke the family
      // (SEC-AUT-004).
      final results = await Future.wait([
        client.get<Map<String, dynamic>>('/a'),
        client.get<Map<String, dynamic>>('/b'),
      ]);

      expect(results.every((r) => r['ok'] == true), true);
      expect(store.refreshToken, 'rotated-refresh');
    });
  });
}