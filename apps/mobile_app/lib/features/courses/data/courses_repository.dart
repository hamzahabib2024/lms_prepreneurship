import '../../../core/network/api_client.dart';
import '../../academic/data/models/subject.dart';
import 'models/course.dart';
import 'models/course_lectures.dart';
import 'models/lecture_source.dart';
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

  // ---------------------------------------------------- the lecture source ---

  /// FR-VID-003 — the Institute's lecture folders, by name and by id.
  ///
  /// OFFICE ONLY, enforced by the server on `lecture_storage_index`. A folder
  /// id is close to a bearer token for that folder's contents, and a teacher
  /// holding one could point their own class at another cohort's recordings —
  /// so a teacher who reaches this gets a 403 rather than a list.
  Future<FolderIndex> storageFolders({String? parent}) async {
    final data = await api.get<Map<String, dynamic>>(
      parent == null
          ? '/storage/folders'
          : '/storage/folders?parent=${Uri.encodeQueryComponent(parent)}',
    );
    return FolderIndex.fromJson(data);
  }

  /// Connect this class to a folder, or disconnect it with an empty string.
  ///
  /// The whole Drive URL is accepted and reduced to an id on the server:
  /// pasting the address bar is what people actually do.
  Future<String?> setLectureFolder({
    required String sectionSubjectId,
    required String folderRef,
  }) async {
    final data = await api.put<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/lecture-folder',
      {'folderRef': folderRef.trim()},
    );
    return data['lectureFolderRef'] as String?;
  }

  /// Read the folder now rather than waiting for the hourly pass.
  Future<SyncOutcome> syncLectures(String sectionSubjectId) async {
    final data = await api.post<Map<String, dynamic>>(
      '/section-subjects/$sectionSubjectId/sync-lectures',
    );
    return SyncOutcome.fromJson(data);
  }

  /// FR-CNT-016 — publish or withdraw one recording.
  ///
  /// A lecture arrives from a sync as a DRAFT (BR-CNT-01) and is invisible to
  /// students until this is called. Withdrawing sends UNPUBLISHED rather than
  /// DRAFT: the two are different states, and a recording that was published
  /// and pulled back is not the same thing as one nobody has looked at yet.
  Future<void> setLecturePublication({
    required String lectureId,
    required bool published,
  }) async {
    await api.post<dynamic>(
      '/recorded-lectures/$lectureId/publication',
      {'status': published ? 'PUBLISHED' : 'UNPUBLISHED'},
    );
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
