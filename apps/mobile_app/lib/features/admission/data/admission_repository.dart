import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import 'models/application_detail.dart';
import 'models/application_draft.dart';
import 'models/approval_result.dart';
import 'models/prospectus.dart';
import 'models/queue_item.dart';
import 'models/section_summary.dart';
import 'models/submission_result.dart';

/// Admission endpoints — SRS §5.1 and §9.4.
///
/// The public half needs no session and is what a stranger reaches from the
/// sign-in screen (FR-REG-001). The administrative half is gated by the
/// server's `registration_queue` permission like the web client.
class AdmissionRepository {
  AdmissionRepository({required this.api});

  final ApiClient api;

  // ------------------------------------------------------------- public ----

  /// FR-REG-002 — what a stranger can apply for.
  Future<List<ProspectusProgramme>> prospectus() async {
    final data = await api.get<List<dynamic>>('/public/prospectus');
    return data
        .whereType<Map<String, dynamic>>()
        .map(ProspectusProgramme.fromJson)
        .toList();
  }

  /// FR-REG-008 — one slip, uploaded BEFORE the application exists.
  Future<String> uploadSlip({required String filename, required List<int> bytes}) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final data = await api.uploadForm<Map<String, dynamic>>('/public/registrations/slips', form);
    return data['documentId'] as String? ?? '';
  }

  /// FR-REG-001/018 — submit. A probable duplicate returns the existing
  /// application's reference instead of a second record (FR-REG-016).
  Future<SubmissionResult> submit(ApplicationDraft draft) async {
    final data = await api.post<Map<String, dynamic>>(
      '/public/registrations',
      draft.toSubmitJson(),
    );
    return SubmissionResult.fromJson(data);
  }

  /// FR-REG-020 — unauthenticated status by tracking reference.
  Future<ApplicationStatusResult> publicStatus(String trackingRef) async {
    final data = await api.get<Map<String, dynamic>>(
      '/public/registrations/${Uri.encodeComponent(trackingRef)}/status',
    );
    return ApplicationStatusResult.fromJson(data);
  }

  // ---------------------------------------------------------- administrative --

  /// FR-REG-022/023 — the review queue, oldest first. Walks the pages so a
  /// queue is not truncated at the first page of twenty-five.
  Future<List<QueueItem>> queue({String? status, String? q}) async {
    final out = <QueueItem>[];
    var page = 1;
    while (true) {
      final query = <String, String>{
        'page': '$page',
        'pageSize': '100',
        if (status != null && status.isNotEmpty) 'status': status,
        if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
      };
      final joined = query.entries
          .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
          .join('&');
      final envelope = await api.getEnvelope('/registration-requests?$joined');
      out.addAll(
        (envelope['data'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(QueueItem.fromJson),
      );
      final pagination = envelope['pagination'] as Map<String, dynamic>? ?? const {};
      if (pagination['hasNext'] != true) break;
      page += 1;
    }
    return out;
  }

  /// FR-REG-025 — one application with its slips.
  Future<ApplicationDetail> detail(String id) async {
    final data = await api.get<Map<String, dynamic>>('/registration-requests/$id');
    return ApplicationDetail.fromJson(data);
  }

  /// FR-REG-024 — the slip itself, streamed. The bytes are somebody's bank
  /// record; they are fetched with the session and rendered, never linked.
  Future<List<int>> slipBytes(String requestId, String documentId) {
    return api.bytes('/registration-requests/$requestId/documents/$documentId');
  }

  /// FR-CRS-010 — sections with occupancy, for the assignment control. Walks
  /// the pages so the control is never short of a section to offer.
  Future<List<SectionSummary>> sections() async {
    final out = <SectionSummary>[];
    var page = 1;
    while (true) {
      final envelope = await api.getEnvelope('/sections?pageSize=100&page=$page');
      out.addAll(
        (envelope['data'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(SectionSummary.fromJson),
      );
      final pagination = envelope['pagination'] as Map<String, dynamic>? ?? const {};
      if (pagination['hasNext'] != true) break;
      page += 1;
    }
    return out;
  }

  /// FR-REG-039 — verify payment and provision the account, atomically.
  Future<ApprovalResult> approve({
    required String id,
    required num verifiedAmount,
    required DateTime paymentDate,
    required String method,
    String? bankReference,
    String? varianceReason,
    required String sectionId,
    bool capacityOverride = false,
    String? note,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/registration-requests/$id/approve',
      {
        'payment': {
          'verifiedAmount': verifiedAmount,
          'currency': 'PKR',
          'paymentDate': ApplicationDraft.dateOnly(paymentDate),
          'method': method,
          if (bankReference != null && bankReference.trim().isNotEmpty)
            'bankReference': bankReference.trim(),
          if (varianceReason != null && varianceReason.trim().isNotEmpty)
            'varianceReason': varianceReason.trim(),
        },
        'sectionId': sectionId,
        'capacityOverride': capacityOverride,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
    return ApprovalResult.fromJson(data);
  }

  /// FR-REG-033/034/046 — reject with a mandatory reason code.
  Future<void> reject({
    required String id,
    required String reasonCode,
    String? note,
  }) async {
    await api.post<void>(
      '/registration-requests/$id/reject',
      {
        'reasonCode': reasonCode,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    );
  }
}
