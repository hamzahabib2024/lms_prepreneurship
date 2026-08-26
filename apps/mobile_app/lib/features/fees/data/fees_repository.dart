/// Repository for the fees domain — SRS §5.11, FR-FEE-001..028.
library;

import 'package:dio/dio.dart';

import '../../../../core/network/api_client.dart';
import 'models/fees_models.dart';

class FeesRepository {
  const FeesRepository(this._api);
  final ApiClient _api;

  // ── Student endpoints ──

  Future<FeeSummary> getMyFeeSummary() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/submissions/context',
    );
    return FeeSummary.fromJson(result['summary'] as Map<String, dynamic>? ?? const {});
  }

  Future<BankDetails> getBankDetails() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/submissions/context',
    );
    return BankDetails.fromJson(result['bankDetails'] as Map<String, dynamic>? ?? const {});
  }

  Future<List<PaymentSubmission>> getMySubmissions() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/submissions/mine',
    );
    return (result['submissions'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(PaymentSubmission.fromJson)
        .toList();
  }

  Future<PaymentSubmission> submitPayment({
    required num amount,
    required String method,
    required String paidOn,
    String? bankReference,
    String? studentNote,
  }) async {
    final body = <String, dynamic>{
      'amount': amount,
      'method': method,
      'paidOn': paidOn,
    };
    if (bankReference != null) body['bankReference'] = bankReference;
    if (studentNote != null) body['studentNote'] = studentNote;

    final result = await _api.post<Map<String, dynamic>>(
      '/api/v1/fees/submissions',
      body,
    );
    return PaymentSubmission.fromJson(result);
  }

  Future<void> uploadProof({
    required String submissionId,
    required String filename,
    required List<int> fileBytes,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(fileBytes, filename: filename),
    });
    await _api.uploadForm<dynamic>(
      '/api/v1/fees/submissions/proof?submissionId=$submissionId',
      formData,
    );
  }

  Future<void> withdrawSubmission(String submissionId) async {
    await _api.delete<dynamic>('/api/v1/fees/submissions/$submissionId');
  }

  Future<Receipt> getReceipt(String paymentId) async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/payments/$paymentId/receipt',
    );
    return Receipt.fromJson(result);
  }

  // ── Staff endpoints ──

  Future<List<DebtorRow>> getDebtors() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/debtors',
    );
    return (result['debtors'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(DebtorRow.fromJson)
        .toList();
  }

  Future<VerificationStats> getVerificationStats() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/submissions/stats',
    );
    return VerificationStats.fromJson(result);
  }

  Future<List<VerificationQueueRow>> getVerificationQueue({
    String? status,
    String? query,
  }) async {
    final params = <String, String>{};
    if (status != null && status.isNotEmpty) params['status'] = status;
    if (query != null && query.isNotEmpty) params['q'] = query;

    final queryString = params.isNotEmpty
        ? '?${params.entries.map((e) => '${e.key}=${e.value}').join('&')}'
        : '';

    final result = await _api.get<Map<String, dynamic>>(
      '/api/v1/fees/submissions$queryString',
    );
    return (result['submissions'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(VerificationQueueRow.fromJson)
        .toList();
  }

  Future<void> verifySubmission({
    required String submissionId,
    required num verifiedAmount,
    String? note,
  }) async {
    final body = <String, dynamic>{
      'verifiedAmount': verifiedAmount,
    };
    if (note != null) body['note'] = note;

    await _api.post<dynamic>(
      '/api/v1/fees/submissions/$submissionId/verify',
      body,
    );
  }

  Future<void> rejectSubmission({
    required String submissionId,
    required String reason,
  }) async {
    await _api.post<dynamic>(
      '/api/v1/fees/submissions/$submissionId/reject',
      {'reason': reason},
    );
  }
}
