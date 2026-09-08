import '../../../core/network/api_client.dart';
import '../models/email_queue_summary.dart';

class EmailQueueRepository {
  EmailQueueRepository({required this.api});

  final ApiClient api;

  Future<EmailQueueSummary> getQueue() async {
    final data = await api.get<Map<String, dynamic>>('/admin/email-queue');
    return EmailQueueSummary.fromJson(data);
  }

  Future<Map<String, dynamic>> approve({required List<String> ids}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/email-queue/approve',
      {'ids': ids},
    );
    return data;
  }

  Future<Map<String, dynamic>> discard({required List<String> ids}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/admin/email-queue/discard',
      {'ids': ids},
    );
    return data;
  }
}
