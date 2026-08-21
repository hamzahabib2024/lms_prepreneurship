import '../../../core/network/api_client.dart';
import '../../academic/data/models/subject.dart';
import 'models/course.dart';
import 'models/course_lectures.dart';
import 'models/lesson_resource.dart';
import 'models/playback_ticket.dart';

/// Recorded lecture and content management endpoints — the mobile equivalent
/// of the web's Courses, Watch, and Subject pages.
///
/// Every call is scoped by the server to the caller's enrolments or
/// assignments (ARC-051). The client never filters by role.
class CoursesRepository {
  CoursesRepository({required this.api});

  final ApiClient api;

  // --------------------------------------------------------------- courses ---

  /// All classes the caller may see — FR-CRS-033.
  Future<List<Course>> listCourses() async {
    final data = await api.get<List<dynamic>>('/courses');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Course.fromJson)
        .toList();
  }

  // ----------------------------------------------------------- lectures ---

  /// Lectures for a specific class, with per-lecture watch state.
  Future<CourseLectures> lecturesFor(String sectionSubjectId) async {
    final data = await api.get<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/lectures',
    );
    return CourseLectures.fromJson(data);
  }

  /// Issue a short-lived playback ticket — FR-VID-008, ARC-039.
  Future<PlaybackTicket> issuePlaybackTicket(String lectureId) async {
    final data = await api.post<Map<String, dynamic>>(
      '/recorded-lectures/$lectureId/playback-ticket',
    );
    return PlaybackTicket.fromJson(data);
  }

  /// Report watch position and intervals — FR-VID-010.
  Future<Map<String, dynamic>> reportProgress(
    String lectureId, {
    required int positionSeconds,
    required List<List<int>> watchedIntervals,
  }) async {
    final data = await api.patch<Map<String, dynamic>>(
      '/recorded-lectures/$lectureId/progress',
      {
        'positionSeconds': positionSeconds,
        'watchedIntervals': watchedIntervals,
      },
    );
    return data;
  }

  // ---------------------------------------------------------- content ---

  /// Module/lesson tree for a subject — FR-CRS-027..032.
  Future<List<Module>> contentTree(String subjectId) async {
    final data = await api.get<List<dynamic>>('/subjects/$subjectId/content');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Module.fromJson)
        .toList();
  }

  // ------------------------------------------------------- resources ---

  /// Downloadable resources for a lesson.
  Future<List<LessonResource>> lessonResources(String lessonId) async {
    final data = await api.get<List<dynamic>>('/lessons/$lessonId/resources');
    return data
        .whereType<Map<String, dynamic>>()
        .map(LessonResource.fromJson)
        .toList();
  }

  /// Download a resource file — returns raw bytes.
  Future<List<int>> downloadResource(String resourceId) {
    return api.bytes('/lesson-resources/$resourceId/download');
  }
}
