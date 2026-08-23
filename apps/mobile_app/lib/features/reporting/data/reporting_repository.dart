import '../../../core/network/api_client.dart';
import 'models/models.dart';

/// Reporting endpoints — SRS §14, §5.17, FR-RPT-001..020.
///
/// The catalogue is server-filtered to only permitted reports (FR-RPT-019).
/// Scope is applied automatically by the server (FR-RPT-002) — a teacher's
/// queries return only their own sections.
class ReportingRepository {
  ReportingRepository({required this.api});

  final ApiClient api;

  /// The reports this caller may run (FR-RPT-019).
  Future<List<ReportDefinition>> catalogue() async {
    final data = await api.get<List<dynamic>>('/reports');
    return data
        .whereType<Map<String, dynamic>>()
        .map(ReportDefinition.fromJson)
        .toList();
  }

  /// Run a report with query-string filters (FR-RPT-002/003).
  Future<ReportResult> run(String key, {Map<String, String>? filters}) async {
    final params = <String>[];
    if (filters != null) {
      for (final entry in filters.entries) {
        if (entry.value.isNotEmpty) {
          params.add('${entry.key}=${Uri.encodeQueryComponent(entry.value)}');
        }
      }
    }
    final query = params.isNotEmpty ? '?${params.join('&')}' : '';
    final data = await api.get<Map<String, dynamic>>('/reports/$key$query');
    return ReportResult.fromJson(data);
  }

  /// CSV export — returns raw bytes for download (FR-RPT-004).
  Future<List<int>> export(String key, {Map<String, String>? filters}) async {
    final params = <String>[];
    if (filters != null) {
      for (final entry in filters.entries) {
        if (entry.value.isNotEmpty) {
          params.add('${entry.key}=${Uri.encodeQueryComponent(entry.value)}');
        }
      }
    }
    final query = params.isNotEmpty ? '?${params.join('&')}' : '';
    return api.bytes('/reports/$key/export$query');
  }

  /// Available sections for filter pickers.
  Future<List<ReportSection>> sections() async {
    final data = await api.get<List<dynamic>>('/sections');
    return data
        .whereType<Map<String, dynamic>>()
        .map(ReportSection.fromJson)
        .toList();
  }
}
