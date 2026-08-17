import 'package:dio/dio.dart';

import '../../../../core/constants.dart';
import '../models/auth_session.dart';

class AuthRepository {
  AuthRepository({Dio? dio}) : _dio = dio ?? Dio(BaseOptions(baseUrl: AppConstants.apiBaseUrl));

  final Dio _dio;

  Future<AuthSession> login({required String email, required String password}) async {
    try {
      final response = await _dio.post(
        '/auth/login',
        data: {
          'email': email.trim(),
          'password': password,
          'deviceLabel': 'mobile-app',
        },
      );

      final data = response.data as Map<String, dynamic>;
      return AuthSession.fromJson(data);
    } on DioException catch (error) {
      final message = _extractMessage(error);
      throw Exception(message);
    }
  }

  Future<void> logout() async {
    try {
      await _dio.post('/auth/logout');
    } on DioException {
      // Best effort. Keep the app usable even if the server response fails.
    }
  }

  String _extractMessage(DioException error) {
    final data = error.response?.data;
    if (data is Map<String, dynamic>) {
      final message = data['message'];
      if (message is String && message.isNotEmpty) {
        return message;
      }
    }

    if (error.type == DioExceptionType.connectionTimeout) {
      return 'Connection timed out. Please try again.';
    }
    if (error.type == DioExceptionType.receiveTimeout) {
      return 'Server response timed out. Please try again.';
    }
    if (error.type == DioExceptionType.connectionError) {
      return 'Unable to reach the server.';
    }

    return 'Login failed. Please check your credentials.';
  }
}
