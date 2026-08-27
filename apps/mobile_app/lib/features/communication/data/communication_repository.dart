import '../../../core/network/api_client.dart';
import 'models/models.dart';

/// Communication endpoints — SRS §5.16, FR-COM-001..020, FR-DSC-001..012.
///
/// Covers announcements, inbox, notification preferences, discussions and
/// integration statuses. Every call is scoped by the server to the caller's
/// permissions and audience membership.
class CommunicationRepository {
  CommunicationRepository({required this.api});

  final ApiClient api;

  // ----------------------------------------------------------- announcements --

  Future<List<Announcement>> listAnnouncements() async {
    final data = await api.get<List<dynamic>>('/announcements');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Announcement.fromJson)
        .toList();
  }

  /// Returns the number of people notified.
  Future<int> createAnnouncement({
    required String audience,
    String? sectionSubjectId,
    required String title,
    required String body,
    String priority = 'NORMAL',
    bool isPinned = false,
  }) async {
    final result = await api.post<Map<String, dynamic>>('/announcements', {
      'audience': audience,
      'sectionSubjectId': ?sectionSubjectId,
      'title': title,
      'body': body,
      'priority': priority,
      'isPinned': isPinned,
    });
    return result['notified'] as int? ?? 0;
  }

  Future<void> withdrawAnnouncement(String id) {
    return api.post<void>('/announcements/$id/withdraw');
  }

  // ----------------------------------------------------------------- inbox --

  Future<InboxResponse> inbox({bool unreadOnly = false, int limit = 50}) async {
    final params = <String>[
      'limit=$limit',
      if (unreadOnly) 'unreadOnly=true',
    ];
    final data = await api.get<Map<String, dynamic>>(
      '/me/notifications?${params.join('&')}',
    );
    return InboxResponse.fromJson(data);
  }

  Future<void> markRead(List<String> notificationIds) {
    return api.patch<void>('/me/notifications/read', {
      'notificationIds': notificationIds,
    });
  }

  Future<void> markAllRead() {
    return api.post<void>('/me/notifications/read-all');
  }

  // -------------------------------------------------------- preferences --

  Future<NotificationPreference> myPreference() async {
    final data = await api.get<Map<String, dynamic>>(
      '/me/notification-preferences',
    );
    return NotificationPreference.fromJson(data);
  }

  Future<NotificationPreference> updatePreference({
    List<String>? channels,
    List<String>? mutedKinds,
    int? quietHoursStart,
    int? quietHoursEnd,
    bool clearQuietHours = false,
  }) async {
    final data = await api.patch<Map<String, dynamic>>(
      '/me/notification-preferences',
      {
        'channels': ?channels,
        'mutedKinds': ?mutedKinds,
        if (clearQuietHours) ...{
          'quietHoursStart': null,
          'quietHoursEnd': null,
        } else ...{
          'quietHoursStart': ?quietHoursStart,
          'quietHoursEnd': ?quietHoursEnd,
        },
      },
    );
    return NotificationPreference.fromJson(data);
  }

  // -------------------------------------------------------- discussions --

  Future<List<DiscussionPost>> listDiscussions(String sectionSubjectId) async {
    final data = await api.get<List<dynamic>>(
      '/section-subjects/$sectionSubjectId/discussions',
    );
    return data
        .whereType<Map<String, dynamic>>()
        .map(DiscussionPost.fromJson)
        .toList();
  }

  Future<DiscussionThread> getThread(String postId) async {
    final data = await api.get<Map<String, dynamic>>('/discussions/$postId');
    return DiscussionThread.fromJson(data);
  }

  Future<DiscussionPost> createDiscussion({
    required String sectionSubjectId,
    required String title,
    required String body,
    bool isAnonymous = false,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/discussions',
      {'title': title, 'body': body, if (isAnonymous) 'isAnonymous': true},
    );
    return DiscussionPost.fromJson(data);
  }

  Future<DiscussionPost> replyToDiscussion({
    required String postId,
    required String body,
    bool isAnonymous = false,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/discussions/$postId/replies',
      {'body': body, if (isAnonymous) 'isAnonymous': true},
    );
    return DiscussionPost.fromJson(data);
  }

  Future<DiscussionPost> editPost({
    required String postId,
    required String body,
  }) async {
    final data = await api.patch<Map<String, dynamic>>(
      '/discussions/$postId',
      {'body': body},
    );
    return DiscussionPost.fromJson(data);
  }

  Future<void> removePost({required String postId, String? reason}) {
    return api.delete<void>('/discussions/$postId', {
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    });
  }

  Future<DiscussionPost> moderatePost({
    required String postId,
    bool? isPinned,
    bool? isLocked,
  }) async {
    final data = await api.post<Map<String, dynamic>>(
      '/discussions/$postId/moderate',
      {
        'isPinned': ?isPinned,
        'isLocked': ?isLocked,
      },
    );
    return DiscussionPost.fromJson(data);
  }

  Future<DiscussionPost> endorsePost({required String postId}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/discussions/$postId/endorse',
    );
    return DiscussionPost.fromJson(data);
  }

  Future<DiscussionPost> resolvePost({required String postId}) async {
    final data = await api.post<Map<String, dynamic>>(
      '/discussions/$postId/resolve',
    );
    return DiscussionPost.fromJson(data);
  }

  // ------------------------------------------------------ offerings --

  Future<List<Offering>> listOfferings() async {
    final sections = await api.get<List<dynamic>>('/sections');
    final found = <Offering>[];
    for (final s in sections.whereType<Map<String, dynamic>>()) {
      final sectionId = s['id'] as String;
      final sectionCode = s['code'] as String? ?? '';
      final subs = await api.get<List<dynamic>>(
        '/sections/$sectionId/subjects',
      );
      for (final o in subs.whereType<Map<String, dynamic>>()) {
        final subject = o['subject'] as Map<String, dynamic>? ?? {};
        found.add(Offering(
          id: o['id'] as String,
          label:
              '${subject['code'] ?? ''} ${subject['name'] ?? ''} — $sectionCode',
        ));
      }
    }
    return found;
  }

  Future<List<SectionSubject>> mySections() async {
    final data = await api.get<Map<String, dynamic>>('/dashboards/me');
    final widgets = data['widgets'] as Map<String, dynamic>? ?? {};
    final mySections = widgets['mySections'] as List<dynamic>? ?? const [];
    return mySections
        .whereType<Map<String, dynamic>>()
        .map(SectionSubject.fromJson)
        .toList();
  }

  // --------------------------------------------------- integrations --

  Future<List<IntegrationStatus>> integrationStatuses() async {
    final data = await api.get<List<dynamic>>('/integrations');
    return data
        .whereType<Map<String, dynamic>>()
        .map(IntegrationStatus.fromJson)
        .toList();
  }
}
