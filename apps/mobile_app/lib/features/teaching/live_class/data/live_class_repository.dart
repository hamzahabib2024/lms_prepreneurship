/// Ad-hoc classes — SRS §9.7, FR-LIV.
library;

import '../../../../core/network/api_client.dart';
import 'models/live_class_models.dart';

class LiveClassRepository {
  const LiveClassRepository(this._api);

  final ApiClient _api;

  /// The picker behind "start now". Refused for anybody without
  /// `live_session:create`, which as far as the caller is concerned is the
  /// same answer as "you teach nothing".
  Future<List<TeachingAssignment>> myTeaching() async {
    final data = await _api.get<List<dynamic>>('/me/teaching');
    return data
        .whereType<Map<String, dynamic>>()
        .map(TeachingAssignment.fromJson)
        .toList();
  }

  /// FR-LIV — a class with nothing scheduled in advance.
  ///
  /// Two fields only. A teacher pressing this has students in front of them,
  /// and every field except which subject already has a sensible answer;
  /// [durationMinutes] is how long the class holds their diary against the
  /// clash check, not a commitment to teach for that long.
  Future<StartedClass> startNow({
    required String sectionSubjectId,
    int? durationMinutes,
  }) async {
    final data = await _api.post<Map<String, dynamic>>(
      '/live-sessions/start-now',
      {
        'sectionSubjectId': sectionSubjectId,
        'durationMinutes': ?durationMinutes,
      },
    );
    return StartedClass.fromJson(data);
  }

  /// FR-LIV — the class is over.
  ///
  /// An update, not a delete: ending a class that happened is a normal part
  /// of teaching it, and cancelling one that did not is the destructive act.
  Future<void> end(String sessionId) async {
    await _api.post<dynamic>('/live-sessions/$sessionId/end');
  }

  /// FR-SAD-008 — the providers and whether they are answering.
  Future<List<LiveProvider>> providers() async {
    final data = await _api.get<List<dynamic>>('/live-providers');
    return data
        .whereType<Map<String, dynamic>>()
        .map(LiveProvider.fromJson)
        .toList();
  }
}
