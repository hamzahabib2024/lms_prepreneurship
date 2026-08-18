import 'package:dio/dio.dart';

import '../constants.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// The API client — the mobile equivalent of apps/web/src/api/client.ts.
///
/// One place that understands the response envelope, so no screen ever reaches
/// into `response.data.data`. It also owns token refresh, because a 401
/// halfway through a form submission must not lose the user's work.
class ApiClient {
  ApiClient({
    TokenStore? tokenStore,
    Dio? dio,
  })  : _tokenStore = tokenStore ?? TokenStore.instance,
        _dio = dio ??
            Dio(
              BaseOptions(
                baseUrl: AppConstants.apiBaseUrl,
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 30),
              ),
            ) {
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _tokenStore.accessToken;
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          options.headers['Accept'] = 'application/json';
          handler.next(options);
        },
      ),
    );
  }

  final TokenStore _tokenStore;
  final Dio _dio;

  /// Called when refresh fails, so the app can route back to sign-in.
  void Function()? onUnauthenticated;

  /// A single in-flight refresh shared by every caller — the same guard the
  /// web client has. Without this, parallel callers each fire their own
  /// refresh; the server rotates the token on first use, so the others then
  /// present a consumed token — which SEC-AUT-004 treats as theft and
  /// invalidates the whole family.
  Future<bool>? _refreshInFlight;

  Future<bool> _refreshAccessToken() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight;

    final future = _doRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
    _refreshInFlight = future;
    return future;
  }

  Future<bool> _doRefresh() async {
    final refreshToken = _tokenStore.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) return false;

    try {
      final response = await _dio.post(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      final body = response.data as Map<String, dynamic>;
      final data = (body['data'] as Map<String, dynamic>?) ?? const {};
      final access = data['accessToken'] as String?;
      final rotated = data['refreshToken'] as String?;
      if (access == null || rotated == null) return false;
      _tokenStore.accessToken = access;
      _tokenStore.setRefreshToken(rotated);
      return true;
    } on DioException {
      _tokenStore.clear();
      return false;
    }
  }

  Future<T> get<T>(String path) => _request<T>(path);

  Future<T> post<T>(String path, [Object? body]) =>
      _request<T>(path, method: 'POST', body: body);

  Future<T> patch<T>(String path, [Object? body]) =>
      _request<T>(path, method: 'PATCH', body: body);

  Future<T> put<T>(String path, [Object? body]) =>
      _request<T>(path, method: 'PUT', body: body);

  Future<T> delete<T>(String path, [Object? body]) =>
      _request<T>(path, method: 'DELETE', body: body);

  /// Multipart upload (payment slips, FR-REG-008). The JSON content-type
  /// header is deliberately absent — the boundary must come from Dio.
  Future<T> uploadForm<T>(String path, FormData form) async {
    try {
      final response = await _dio.post<dynamic>(path, data: form);
      final envelope = response.data as Map<String, dynamic>? ?? const {};
      return (envelope['data'] as T);
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  /// Raw response bytes (a payment slip for review, FR-REG-024). Never a
  /// storage URL — the object is somebody's bank record and must not be
  /// reachable without a session (SEC-FIL-009).
  Future<List<int>> bytes(String path) async {
    try {
      final response = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes),
      );
      return response.data ?? const [];
    } on DioException catch (error) {
      throw _mapError(error);
    }
  }

  Future<T> _request<T>(
    String path, {
    String method = 'GET',
    Object? body,
    bool retried = false,
  }) async {
    final options = Options(method: method, contentType: Headers.jsonContentType);

    try {
      final response = await _dio.request<dynamic>(path, data: body, options: options);

      if (response.statusCode == 204) return null as T;

      final envelope = response.data as Map<String, dynamic>? ?? const {};
      // §9.2 — every success is wrapped. Screens receive the payload itself.
      return (envelope['data'] as T);
    } on DioException catch (error) {
      final apiError = _mapError(error);

      // An expired access token is routine, not a failure: refresh once and
      // replay the request so the user never notices.
      if (apiError.status == 401 &&
          apiError.code == 'AUTH_TOKEN_EXPIRED' &&
          !retried) {
        if (await _refreshAccessToken()) {
          return _request<T>(path, method: method, body: body, retried: true);
        }
        onUnauthenticated?.call();
      }
      if (apiError.status == 401 && retried) onUnauthenticated?.call();

      throw apiError;
    }
  }

  ApiException _mapError(DioException error) {
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      return ApiException.fromBody(error.response?.statusCode ?? 0, data);
    }

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
        return const ApiException(
          status: 0,
          message: 'Connection timed out. Please try again.',
        );
      case DioExceptionType.receiveTimeout:
        return const ApiException(
          status: 0,
          message: 'Server response timed out. Please try again.',
        );
      case DioExceptionType.connectionError:
        return const ApiException(
          status: 0,
          message: 'Unable to reach the server.',
        );
      default:
        return ApiException(
          status: error.response?.statusCode ?? 0,
          message: error.message ?? 'Something went wrong.',
        );
    }
  }
}