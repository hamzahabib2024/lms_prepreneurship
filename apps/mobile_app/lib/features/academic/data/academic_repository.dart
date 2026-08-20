import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import 'models/section.dart';
import 'models/structure.dart';
import 'models/subject.dart';
import 'models/timetable.dart';

/// Academic management endpoints — SRS §5.3, the mobile equivalent of the
/// web's Structure, Sections, Subjects, Content, Timetable and Teaching staff
/// screens.
///
/// Every call is guarded by the same permission matrix the web hits; the
/// server decides, and a screen that is not offered to a role simply never
/// fetches.
class AcademicRepository {
  AcademicRepository({required this.api});

  final ApiClient api;

  // ---------------------------------------------------------- programmes ----

  Future<List<Programme>> listProgrammes() async {
    final data = await api.get<List<dynamic>>('/programmes');
    return data
        .whereType<Map<String, dynamic>>()
        .map(Programme.fromJson)
        .toList();
  }

  Future<void> createProgramme({
    required String name,
    required String code,
    String? description,
    int? durationWeeks,
  }) {
    return api.post<void>('/programmes', {
      'name': name,
      'code': code,
      if (description != null && description.isNotEmpty) 'description': description,
      if (durationWeeks != null && durationWeeks > 0) 'durationWeeks': durationWeeks,
    });
  }

  // -------------------------------------------------- sessions and batches --

  Future<List<AcademicSession>> listSessions({String? programmeId}) async {
    final query = programmeId == null || programmeId.isEmpty
        ? ''
        : '?programmeId=${Uri.encodeQueryComponent(programmeId)}';
    final data = await api.get<List<dynamic>>('/academic-sessions$query');
    return data
        .whereType<Map<String, dynamic>>()
        .map(AcademicSession.fromJson)
        .toList();
  }

  Future<void> createSession({
    required String programmeId,
    required String name,
    required String code,
    required DateTime startDate,
    required DateTime endDate,
  }) {
    return api.post<void>('/academic-sessions', {
      'programmeId': programmeId,
      'name': name,
      'code': code,
      'startDate': Formats.isoDate(startDate),
      'endDate': Formats.isoDate(endDate),
    });
  }

  Future<void> updateSession(
    String id, {
    String? name,
    String? status,
    DateTime? startDate,
    DateTime? endDate,
  }) {
    return api.patch<void>('/academic-sessions/$id', {
      if (name != null && name.isNotEmpty) 'name': name,
      if (status != null && status.isNotEmpty) 'status': status,
      if (startDate != null) 'startDate': Formats.isoDate(startDate),
      if (endDate != null) 'endDate': Formats.isoDate(endDate),
    });
  }

  Future<List<Batch>> listBatches({String? sessionId}) async {
    final query =
        sessionId == null || sessionId.isEmpty ? '' : '?academicSessionId=$sessionId';
    final data = await api.get<List<dynamic>>('/batches$query');
    return data.whereType<Map<String, dynamic>>().map(Batch.fromJson).toList();
  }

  Future<void> createBatch({
    required String academicSessionId,
    required String name,
    required String deliveryPattern,
  }) {
    return api.post<void>('/batches', {
      'academicSessionId': academicSessionId,
      'name': name,
      'deliveryPattern': deliveryPattern,
    });
  }

  Future<void> updateBatch(String id, {String? name, String? deliveryPattern}) {
    return api.patch<void>('/batches/$id', {
      if (name != null && name.isNotEmpty) 'name': name,
      if (deliveryPattern != null && deliveryPattern.isNotEmpty)
        'deliveryPattern': deliveryPattern,
    });
  }

  // ------------------------------------------------------------- sections ----

  /// FR-CRS-008..013. Walks the pages so a catalogue is not truncated at the
  /// first page of twenty-five.
  Future<List<Section>> listSections({String? batchId}) async {
    final out = <Section>[];
    var page = 1;
    while (true) {
      final query = StringBuffer('/sections?pageSize=100&page=$page');
      if (batchId != null && batchId.isNotEmpty) {
        query.write('&batchId=${Uri.encodeQueryComponent(batchId)}');
      }
      final envelope = await api.get<Map<String, dynamic>>(query.toString());
      out.addAll(
        (envelope['data'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(Section.fromJson),
      );
      final pagination = envelope['pagination'] as Map<String, dynamic>? ?? const {};
      if (pagination['hasNext'] != true) break;
      page += 1;
    }
    return out;
  }

  Future<Section> createSection({
    required String batchId,
    required String code,
    required String name,
    required int capacity,
    required String genderRestriction,
    required String shift,
    required String deliveryMode,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/sections', {
      'batchId': batchId,
      'code': code,
      'name': name,
      'capacity': capacity,
      'genderRestriction': genderRestriction,
      'shift': shift,
      'deliveryMode': deliveryMode,
    });
    return Section.fromJson(data);
  }

  Future<void> updateSection(
    String id, {
    String? name,
    int? capacity,
    String? status,
    String? shift,
  }) {
    return api.patch<void>('/sections/$id', {
      if (name != null && name.isNotEmpty) 'name': name,
      'capacity': ?capacity,
      if (status != null && status.isNotEmpty) 'status': status,
      if (shift != null && shift.isNotEmpty) 'shift': shift,
    });
  }

  /// FR-CRS-012/013 — archive, never delete; the server has no DELETE route.
  Future<void> archiveSection(String id) {
    return api.post<void>('/sections/$id/archive');
  }

  /// FR-CRS-016/026 — the subjects offered to one section, with coverage.
  Future<List<Offering>> listOfferings(String sectionId) async {
    final data = await api.get<List<dynamic>>('/sections/$sectionId/subjects');
    return data.whereType<Map<String, dynamic>>().map(Offering.fromJson).toList();
  }

  Future<void> offerSubject({
    required String sectionId,
    required String subjectId,
    required bool isCompulsory,
  }) {
    return api.post<void>('/sections/$sectionId/subjects', {
      'subjectId': subjectId,
      'isCompulsory': isCompulsory,
    });
  }

  // ------------------------------------------------------------- subjects ----

  Future<List<Subject>> listSubjects() async {
    final data = await api.get<List<dynamic>>('/subjects');
    return data.whereType<Map<String, dynamic>>().map(Subject.fromJson).toList();
  }

  Future<void> createSubject({
    required String name,
    required String code,
    String? description,
    int? credits,
  }) {
    return api.post<void>('/subjects', {
      'name': name,
      'code': code,
      if (description != null && description.isNotEmpty) 'description': description,
      if (credits != null && credits > 0) 'credits': credits,
    });
  }

  // -------------------------------------------------------------- content ----

  /// FR-CRS-027..032 — modules, lessons, lectures, with publication state.
  Future<List<Module>> contentTree(String subjectId) async {
    final data = await api.get<List<dynamic>>('/subjects/$subjectId/content');
    return data.whereType<Map<String, dynamic>>().map(Module.fromJson).toList();
  }

  /// BR-CNT-01 — everything is created as a draft.
  Future<void> createModule({required String subjectId, required String title}) {
    return api.post<void>('/modules', {'subjectId': subjectId, 'title': title});
  }

  Future<void> setModulePublication(String id, String status) {
    return api.post<void>('/modules/$id/publication', {'status': status});
  }

  Future<void> createLesson({required String moduleId, required String title}) {
    return api.post<void>('/lessons', {'moduleId': moduleId, 'title': title});
  }

  Future<void> setLessonPublication(String id, String status) {
    return api.post<void>('/lessons/$id/publication', {'status': status});
  }

  // ------------------------------------------------------------- timetable ----

  Future<Timetable> myTimetable({required DateTime from, required DateTime to}) async {
    final data = await api.get<Map<String, dynamic>>(
      '/timetable/me?from=${Formats.isoDate(from)}&to=${Formats.isoDate(to)}',
    );
    return Timetable.fromJson(data);
  }

  /// The whole catalogue of section-subjects, in the same shape the web's
  /// generate panel builds — section first, because the question being
  /// answered is "who teaches THIS class".
  Future<List<OfferingChoice>> offeringChoices() async {
    final out = <OfferingChoice>[];
    var page = 1;
    while (true) {
      final envelope = await api.get<Map<String, dynamic>>(
        '/sections?pageSize=100&page=$page',
      );
      for (final s in (envelope['data'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()) {
        final section = Section.fromJson(s);
        try {
          final offerings = await listOfferings(section.id);
          out.addAll(offerings.map((o) => OfferingChoice(
                id: o.id,
                label: '${section.code} — ${o.subjectCode} ${o.subjectName}',
                hasTeacher: o.hasTeacher,
              )));
        } on Object {
          // One section refused means the catalogue is short, not dead.
        }
      }
      final pagination = envelope['pagination'] as Map<String, dynamic>? ?? const {};
      if (pagination['hasNext'] != true) break;
      page += 1;
    }
    return out;
  }

  Future<TimetablePreview> previewTimetable({
    required String sectionSubjectId,
    required List<int> days,
    required String startTime,
    required String endTime,
    required DateTime fromDate,
    required DateTime toDate,
    required String hostTeacherId,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/timetable/preview', {
      'sectionSubjectId': sectionSubjectId,
      'days': days,
      'startTime': startTime,
      'endTime': endTime,
      'fromDate': Formats.isoDate(fromDate),
      'toDate': Formats.isoDate(toDate),
      'hostTeacherId': hostTeacherId,
    });
    return TimetablePreview.fromJson(data);
  }

  Future<TimetableReport> generateTimetable({
    required String sectionSubjectId,
    required List<int> days,
    required String startTime,
    required String endTime,
    required DateTime fromDate,
    required DateTime toDate,
    required String hostTeacherId,
  }) async {
    final data = await api.post<Map<String, dynamic>>('/timetable/generate', {
      'sectionSubjectId': sectionSubjectId,
      'days': days,
      'startTime': startTime,
      'endTime': endTime,
      'fromDate': Formats.isoDate(fromDate),
      'toDate': Formats.isoDate(toDate),
      'hostTeacherId': hostTeacherId,
    });
    return TimetableReport.fromJson(data);
  }

  // --------------------------------------------------------------- staffing ----

  /// FR-CRS-015 — workload BEFORE the assignment, so overload is noticed
  /// first rather than discovered after.
  Future<List<TeacherLoad>> teacherWorkload() async {
    final data = await api.get<List<dynamic>>('/teachers/workload');
    return data.whereType<Map<String, dynamic>>().map(TeacherLoad.fromJson).toList();
  }

  Future<List<TeacherAssignment>> teacherAssignments(String teacherId) async {
    final data = await api.get<List<dynamic>>('/teachers/$teacherId/assignments');
    return data
        .whereType<Map<String, dynamic>>()
        .map(TeacherAssignment.fromJson)
        .toList();
  }

  /// FR-CRS-021 — BR-ACC-04: a teacher is bound to a subject WITHIN a
  /// section, never to a subject everywhere.
  Future<void> createAssignment({
    required String teacherId,
    required String sectionSubjectId,
    required String assignmentRole,
    required DateTime startDate,
    DateTime? endDate,
  }) {
    return api.post<void>('/teacher-assignments', {
      'teacherId': teacherId,
      'sectionSubjectId': sectionSubjectId,
      'assignmentRole': assignmentRole,
      'startDate': Formats.isoDate(startDate),
      if (endDate != null) 'endDate': Formats.isoDate(endDate),
    });
  }

  /// FR-CRS-023 — ends the assignment; the teacher's scope is revoked on the
  /// next request. The row is kept for history (FR-CRS-024).
  Future<void> endAssignment(String id, {String? reason}) {
    return api.post<void>('/teacher-assignments/$id/end', {
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    });
  }
}