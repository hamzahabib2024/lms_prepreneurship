/// Mirrors the server's error shape (apps/api AllExceptionsFilter) so screens
/// can branch on `code`: every failure arrives as
/// `{ error: { code, message, details[], reference }, meta }`.
class ApiException implements Exception {
  const ApiException({
    required this.status,
    this.code = 'INTERNAL_ERROR',
    required this.message,
    this.details = const [],
    this.reference,
  });

  final int status;
  final String code;
  final String message;
  final List<Map<String, dynamic>> details;
  final String? reference;

  /// Convenience for forms: the message for one field, if any.
  String? fieldError(String field) {
    for (final detail in details) {
      if (detail['field'] == field) return detail['message'] as String?;
    }
    return null;
  }

  factory ApiException.fromBody(int status, Map<String, dynamic> body) {
    final error = (body['error'] as Map<String, dynamic>?) ?? const {};
    return ApiException(
      status: status,
      code: error['code'] as String? ?? 'INTERNAL_ERROR',
      message: error['message'] as String? ?? 'Something went wrong.',
      details: (error['details'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(),
      reference: error['reference'] as String?,
    );
  }

  @override
  String toString() => message;
}