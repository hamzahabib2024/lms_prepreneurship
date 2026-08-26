import '../../../core/network/api_client.dart';
import 'models/learning_models.dart';

/// Student learning endpoints — SRS §13.5, the mobile equivalent of the
/// web's My Subjects and Subject Detail pages.
class LearningRepository {
  LearningRepository({required this.api});

  final ApiClient api;

  /// GET /me/progress — every enrolled subject with progress and outstanding
  /// requirements. FR-PRG-007.
  Future<MyProgress> myProgress() async {
    final data = await api.get<Map<String, dynamic>>('/me/progress');
    return MyProgress.fromJson(data);
  }

  /// GET /me/progress/:sectionSubjectId — one subject's detailed progress
  /// with components, attendance and completion criteria.
  Future<SubjectDetailProgress> subjectProgress(String sectionSubjectId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/me/progress/$sectionSubjectId',
    );
    return SubjectDetailProgress.fromJson(data);
  }

  /// GET /subjects/:subjectId/content — module/lesson/lecture content tree.
  Future<List<LearningModule>> subjectContent(String subjectId) async {
    final data = await api.get<List<dynamic>>('/subjects/$subjectId/content');
    return data
        .whereType<Map<String, dynamic>>()
        .map(LearningModule.fromJson)
        .toList();
  }

  /// GET /lessons/:lessonId/resources — downloadable handouts for a lesson.
  Future<List<Handout>> lessonResources(String lessonId) async {
    final data = await api.get<List<dynamic>>('/lessons/$lessonId/resources');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Handout.fromJson)
        .toList();
  }

  /// Download a lesson resource — returns raw bytes.
  Future<List<int>> downloadResource(String resourceId) {
    return api.bytes('/lesson-resources/$resourceId/download');
  }
}
