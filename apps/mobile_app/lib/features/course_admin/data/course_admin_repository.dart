import '../../../core/network/api_client.dart';
import 'models/course_admin_models.dart';

class CourseAdminRepository {
  CourseAdminRepository(this._api);
  final ApiClient _api;

  /// GET /course-tree – full hierarchy.
  Future<List<Programme>> getCourseTree({String? programmeId}) async {
    final path = programmeId != null
        ? '/course-tree?programmeId=$programmeId'
        : '/course-tree';
    final list = await _api.get<List<dynamic>>(path);
    return list
        .map((e) => Programme.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /subjects – all subjects.
  Future<List<Subject>> getSubjects() async {
    final list = await _api.get<List<dynamic>>('/subjects');
    return list
        .map((e) => Subject.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /subjects – create subject.
  Future<Subject> createSubject({
    required String name,
    required String code,
    String? description,
    int? credits,
  }) async {
    final map = await _api.post<Map<String, dynamic>>(
      '/subjects',
      <String, dynamic>{
        'name': name,
        'code': code,
        'description': ?description,
        'credits': ?credits,
      },
    );
    return Subject.fromJson(map);
  }

  /// PATCH /subjects/:id – update subject.
  Future<Subject> updateSubject({
    required String id,
    String? name,
    String? description,
    int? credits,
    bool? isActive,
  }) async {
    final map = await _api.patch<Map<String, dynamic>>(
      '/subjects/$id',
      <String, dynamic>{
        'name': ?name,
        'description': ?description,
        'credits': ?credits,
        'isActive': ?isActive,
      },
    );
    return Subject.fromJson(map);
  }

  /// POST /programmes – create programme.
  Future<Programme> createProgramme({
    required String name,
    required String code,
    String? description,
    int? durationWeeks,
  }) async {
    final map = await _api.post<Map<String, dynamic>>(
      '/programmes',
      <String, dynamic>{
        'name': name,
        'code': code,
        'description': ?description,
        'durationWeeks': ?durationWeeks,
      },
    );
    return Programme.fromJson(map);
  }

  /// PATCH /programmes/:id – update programme.
  Future<Programme> updateProgramme({
    required String id,
    String? name,
    String? description,
    int? durationWeeks,
    bool? isActive,
  }) async {
    final map = await _api.patch<Map<String, dynamic>>(
      '/programmes/$id',
      <String, dynamic>{
        'name': ?name,
        'description': ?description,
        'durationWeeks': ?durationWeeks,
        'isActive': ?isActive,
      },
    );
    return Programme.fromJson(map);
  }

  /// PUT /programmes/:id/subjects – set course syllabus.
  Future<void> setProgrammeSubjects({
    required String programmeId,
    required List<String> subjectIds,
  }) async {
    await _api.put<dynamic>(
      '/programmes/$programmeId/subjects',
      <String, dynamic>{'subjectIds': subjectIds},
    );
  }

  /// POST /course-batches – create batch (quick path).
  Future<void> createBatch({
    required String programmeId,
    required String name,
    required int capacity,
    required String genderRestriction,
    required String shift,
    required String deliveryMode,
    required List<String> subjectIds,
    String? teacherId,
    String? whatsappChannelUrl,
    String? whatsappGroupUrl,
  }) async {
    await _api.post<dynamic>(
      '/course-batches',
      <String, dynamic>{
        'programmeId': programmeId,
        'name': name,
        'capacity': capacity,
        'genderRestriction': genderRestriction,
        'shift': shift,
        'deliveryMode': deliveryMode,
        'subjectIds': subjectIds,
        'teacherId': ?teacherId,
        'whatsappChannelUrl': ?whatsappChannelUrl,
        'whatsappGroupUrl': ?whatsappGroupUrl,
      },
    );
  }

  /// GET /teachers/workload – list teachers.
  Future<List<Teacher>> getTeachers() async {
    final list = await _api.get<List<dynamic>>('/teachers/workload');
    return list
        .map((e) => Teacher.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /programmes/:id/fee-structures – list fees.
  Future<List<FeeStructure>> getFeeStructures(String programmeId) async {
    final list = await _api.get<List<dynamic>>(
      '/programmes/$programmeId/fee-structures',
    );
    return list
        .map((e) => FeeStructure.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// POST /fee-structures – create fee.
  Future<FeeStructure> createFeeStructure({
    required String programmeId,
    required String name,
    required double totalAmount,
    String? notes,
    List<Map<String, dynamic>>? lines,
  }) async {
    final map = await _api.post<Map<String, dynamic>>(
      '/fee-structures',
      <String, dynamic>{
        'programmeId': programmeId,
        'name': name,
        'totalAmount': totalAmount,
        'notes': ?notes,
        'lines': ?lines,
      },
    );
    return FeeStructure.fromJson(map);
  }

  /// POST /fee-structures/:id/publish – publish fee.
  Future<void> publishFeeStructure(String id) async {
    await _api.post<dynamic>('/fee-structures/$id/publish');
  }

  /// DELETE /fee-structures/:id – delete draft fee.
  Future<void> deleteFeeStructure(String id) async {
    await _api.delete<dynamic>('/fee-structures/$id');
  }
}
