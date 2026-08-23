import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import 'models/audit_entry.dart';
import 'models/backup_item.dart';
import 'models/bulk_report.dart';
import 'models/password_reset_result.dart';
import 'models/security_event.dart';
import 'models/setting_group.dart';
import 'models/staff_creation_result.dart';
import 'models/user_directory_item.dart';

class AdminRepository {
  AdminRepository({required this.api});

  final ApiClient api;

  // -------------------------------------------------------- user directory ---

  Future<Map<String, dynamic>> listUsers({
    String? role,
    String? status,
    String? q,
    int page = 1,
  }) async {
    final params = <String, String>{
      'page': '$page',
      if (role != null && role.isNotEmpty) 'role': role,
      if (status != null && status.isNotEmpty) 'status': status,
      if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
    };
    final qs = params.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    final envelope = await api.getEnvelope('/admin/users?$qs');
    final items = (envelope['data'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(UserDirectoryItem.fromJson)
        .toList();
    return {'users': items, 'pagination': envelope['pagination'] ?? {}};
  }

  Future<StaffCreationResult> createStaff({
    required String email,
    required String fullName,
    String? phone,
    required String role,
    List<String>? subPermissions,
    String? employeeCode,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/users',
      {
        'email': email.trim(),
        'fullName': fullName.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        'role': role,
        if (subPermissions != null && subPermissions.isNotEmpty)
          'subPermissions': subPermissions,
        if (employeeCode != null && employeeCode.trim().isNotEmpty)
          'employeeCode': employeeCode.trim(),
      },
    );
    return StaffCreationResult.fromJson(data);
  }

  Future<Map<String, dynamic>> setUserStatus({
    required String id,
    required String status,
    required String reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/users/$id/status',
      {'status': status, 'reason': reason.trim()},
    );
    return data;
  }

  Future<PasswordResetResult> resetPassword({required String id}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/users/$id/reset-password',
    );
    return PasswordResetResult.fromJson(data);
  }

  Future<Map<String, dynamic>> revokeSessions({required String id}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/users/$id/revoke-sessions',
    );
    return data;
  }

  Future<Map<String, dynamic>> unlockAccount({required String id}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/users/$id/unlock',
    );
    return data;
  }

  Future<Map<String, dynamic>> setSubPermissions({
    required String id,
    required List<String> subPermissions,
  }) async {
    final data = await api.patch<Map<String, dynamic>>(
      '/admin/users/$id/sub-permissions',
      {'subPermissions': subPermissions},
    );
    return data;
  }

  // ------------------------------------------------------------ settings ---

  Future<List<SettingGroup>> listSettings() async {
    final data = await api.get<List<dynamic>>('/settings');
    return data
        .whereType<Map<String, dynamic>>()
        .map(SettingGroup.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> updateSetting({
    required String key,
    required dynamic value,
    String scopeType = 'INSTITUTE',
    String? scopeId,
  }) async {
    final data = await api.put<Map<String, dynamic>>(
      '/settings/${Uri.encodeComponent(key)}',
      {
        'value': value,
        'scopeType': scopeType,
        if (scopeId != null) 'scopeId': scopeId,
      },
    );
    return data;
  }

  Future<Map<String, dynamic>> deleteSetting({
    required String key,
    String scopeType = 'INSTITUTE',
    String? scopeId,
  }) async {
    final data = await api.delete<Map<String, dynamic>>(
      '/settings/${Uri.encodeComponent(key)}'
      '?scopeType=$scopeType'
      '${scopeId != null ? '&scopeId=$scopeId' : ''}',
    );
    return data;
  }

  // ------------------------------------------------------------ backups ---

  Future<List<BackupItem>> listBackups() async {
    final data = await api.get<Map<String, dynamic>>('/admin/backups');
    return (data['backups'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(BackupItem.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> createBackup() async {
    final data = await api.post<Map<String, dynamic>>('/admin/backups');
    return data;
  }

  Future<Map<String, dynamic>> verifyBackup({required String id}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/backups/${Uri.encodeComponent(id)}/verify',
    );
    return data;
  }

  Future<Map<String, dynamic>> restoreBackup({required String id}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/backups/${Uri.encodeComponent(id)}/restore',
      {'confirmation': 'REPLACE ALL DATA'},
    );
    return data;
  }

  // ------------------------------------------------------------ maintenance ---

  Future<Map<String, dynamic>> getMaintenance() async {
    final data = await api.get<Map<String, dynamic>>('/maintenance');
    return data;
  }

  Future<Map<String, dynamic>> setMaintenance({
    required bool enabled,
    String? message,
    String? expectedEndAt,
  }) async {
    final data = await api.put<Map<String, dynamic>>(
      '/maintenance',
      {
        'enabled': enabled,
        if (message != null) 'message': message,
        if (expectedEndAt != null) 'expectedEndAt': expectedEndAt,
      },
    );
    return data;
  }

  // ------------------------------------------------------------ audit ---

  Future<Map<String, dynamic>> listAuditLog({
    String? action,
    String? entityType,
    String? entityId,
    String? from,
    String? to,
    int page = 1,
  }) async {
    final params = <String, String>{
      'page': '$page',
      if (action != null && action.isNotEmpty) 'action': action,
      if (entityType != null && entityType.isNotEmpty) 'entityType': entityType,
      if (entityId != null && entityId.isNotEmpty) 'entityId': entityId,
      if (from != null && from.isNotEmpty) 'from': from,
      if (to != null && to.isNotEmpty) 'to': to,
    };
    final qs = params.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    final envelope = await api.getEnvelope('/admin/audit?$qs');
    final entries = (envelope['data'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(AuditEntry.fromJson)
        .toList();
    return {'entries': entries, 'pagination': envelope['pagination'] ?? {}};
  }

  Future<List<AuditActionCount>> listAuditActions() async {
    final data = await api.get<List<dynamic>>('/admin/audit/actions');
    return data
        .whereType<Map<String, dynamic>>()
        .map(AuditActionCount.fromJson)
        .toList();
  }

  // ------------------------------------------------------------ security ---

  Future<SecurityOverview> getSecurityOverview({int hours = 24}) async {
    final data = await api.get<Map<String, dynamic>>(
      '/admin/security?hours=$hours',
    );
    return SecurityOverview.fromJson(data);
  }

  Future<Map<String, dynamic>> listSecurityEvents({
    String? eventType,
    String? userId,
    String? ipAddress,
    int page = 1,
  }) async {
    final params = <String, String>{
      'page': '$page',
      if (eventType != null && eventType.isNotEmpty) 'eventType': eventType,
      if (userId != null && userId.isNotEmpty) 'userId': userId,
      if (ipAddress != null && ipAddress.isNotEmpty) 'ipAddress': ipAddress,
    };
    final qs = params.entries
        .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');
    final envelope = await api.getEnvelope('/admin/security/events?$qs');
    final events = (envelope['data'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(SecurityEvent.fromJson)
        .toList();
    return {'events': events, 'pagination': envelope['pagination'] ?? {}};
  }

  // ------------------------------------------------------------ bulk ---

  Future<BulkReport> bulkTransferPreview({
    required List<String> studentIds,
    required String toSectionId,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/bulk/transfer/preview',
      {'studentIds': studentIds, 'toSectionId': toSectionId},
    );
    return BulkReport.fromJson(data);
  }

  Future<BulkReport> bulkTransfer({
    required List<String> studentIds,
    required String toSectionId,
    required String reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/bulk/transfer',
      {
        'studentIds': studentIds,
        'toSectionId': toSectionId,
        'reason': reason.trim(),
      },
    );
    return BulkReport.fromJson(data);
  }

  Future<BulkReport> bulkWithdraw({
    required List<String> studentIds,
    required String reason,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/bulk/withdraw',
      {'studentIds': studentIds, 'reason': reason.trim()},
    );
    return BulkReport.fromJson(data);
  }
}
