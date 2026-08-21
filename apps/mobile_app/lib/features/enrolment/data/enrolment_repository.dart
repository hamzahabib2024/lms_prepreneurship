import '../../../core/network/api_client.dart';
import 'models/enrolment.dart';

/// Student enrolment management — SRS §5.4 and §5.24, the mobile equivalent
/// of the web's Enrolments, Sections roster and Bulk screens.
///
/// Every call is guarded by the same permission matrix the web hits: rosters
/// need `section read`, transfers need `enrolment update`, suspension and
/// withdrawal need `account_state update`, and the bulk endpoints need
/// `bulk_operation` (which for an Admin additionally requires the
/// `bulk_operator` sub-permission). The server decides; a screen that is not
/// offered to a role simply never fetches.
class EnrolmentRepository {
  EnrolmentRepository({required this.api});

  final ApiClient api;

  /// FR-ENR-012 — the section roster, ordered by roll number like a register.
  Future<List<RosterRow>> roster(String sectionId) async {
    final data = await api.get<List<dynamic>>('/sections/$sectionId/roster');
    return data.whereType<Map<String, dynamic>>().map(RosterRow.fromJson).toList();
  }

  /// FR-ENR-021 — the complete enrolment history for one student, newest
  /// first. Rows are retained across transfer, suspension and withdrawal.
  Future<List<EnrolmentRow>> history(String studentId) async {
    final data = await api.get<List<dynamic>>('/students/$studentId/enrolments');
    return data.whereType<Map<String, dynamic>>().map(EnrolmentRow.fromJson).toList();
  }

  /// FR-ENR-005/006 — transfer between sections. The registration number
  /// never changes; a new roll number is allocated in the destination.
  Future<TransferResult> transfer({
    required String studentId,
    required String toSectionId,
    required bool carryHistory,
    required String reason,
    bool capacityOverride = false,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/students/$studentId/transfer', {
      'toSectionId': toSectionId,
      'carryHistory': carryHistory,
      'reason': reason,
      'capacityOverride': capacityOverride,
    });
    return TransferResult.fromJson(data);
  }

  /// FR-ENR-007/008 — suspension. The reason is mandatory and shown to the
  /// student, because an unexplained loss of function is indistinguishable
  /// from a fault.
  Future<SuspensionResult> suspend({required String studentId, required String reason}) async {
    final data = await api.post<Map<String, dynamic>>('/students/$studentId/suspend', {
      'reason': reason,
    });
    return SuspensionResult.fromJson(data);
  }

  /// FR-ENR-009/011 — withdrawal. Frees the roll number for reuse within the
  /// section but never the registration number.
  Future<WithdrawalResult> withdraw({required String studentId, required String reason}) async {
    final data = await api.post<Map<String, dynamic>>('/students/$studentId/withdraw', {
      'reason': reason,
    });
    return WithdrawalResult.fromJson(data);
  }

  /// FR-ENR-010 — reinstate a suspended or withdrawn student.
  Future<ReinstateResult> reinstate({
    required String studentId,
    String? reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/students/$studentId/reinstate', {
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    });
    return ReinstateResult.fromJson(data);
  }

  /// FR-OPS-021 — what a bulk transfer WOULD do, before it does it. Not a
  /// guarantee: capacity can change between preview and act, so the real
  /// enforcement stays in the per-student transfer.
  Future<BatchReport> bulkTransferPreview({
    required List<String> studentIds,
    required String toSectionId,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/admin/bulk/transfer/preview', {
      'studentIds': studentIds,
      'toSectionId': toSectionId,
    });
    return BatchReport.fromJson(data);
  }

  /// FR-OPS-022 — move them, one ordinary transfer at a time. NOT
  /// all-or-nothing: the report lists what did not change, first.
  Future<BatchReport> bulkTransfer({
    required List<String> studentIds,
    required String toSectionId,
    required String reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/admin/bulk/transfer', {
      'studentIds': studentIds,
      'toSectionId': toSectionId,
      'reason': reason,
    });
    return BatchReport.fromJson(data);
  }

  /// FR-OPS-023 — withdraw many, with one reason recorded against each.
  Future<BatchReport> bulkWithdraw({
    required List<String> studentIds,
    required String reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/admin/bulk/withdraw', {
      'studentIds': studentIds,
      'reason': reason,
    });
    return BatchReport.fromJson(data);
  }
}