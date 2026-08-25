/// Repository for the assignment builder — SRS §13.6, FR-TCH-020.
library;

import '../../../../core/network/api_client.dart';
import 'models/assignment_builder_models.dart';

class AssignmentBuilderRepository {
  const AssignmentBuilderRepository(this._api);
  final ApiClient _api;

  Future<List<SectionSubject>> getSectionSubjects() async {
    final result = await _api.get<Map<String, dynamic>>(
      '/marking/sections',
    );
    return (result['sections'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(SectionSubject.fromJson)
        .toList();
  }

  Future<AssignmentDraft> createAssignment(AssignmentDraft draft) async {
    final result = await _api.post<Map<String, dynamic>>(
      '/assignments',
      draft.toJson(),
    );
    return AssignmentDraft(
      id: result['id'] as String?,
      title: result['title'] as String? ?? '',
      sectionSubjectId: result['sectionSubjectId'] as String? ?? '',
      marksAvailable: (result['marksAvailable'] as num?)?.toInt() ?? 0,
      dueAt: result['dueAt'] as String? ?? '',
      latePolicy: result['latePolicy'] as String? ?? 'FLAG_ONLY',
      publicationStatus: result['publicationStatus'] as String? ?? 'DRAFT',
      rubricId: result['rubricId'] as String?,
      description: result['description'] as String?,
    );
  }

  Future<AssignmentDraft> updateAssignment(AssignmentDraft draft) async {
    final result = await _api.put<Map<String, dynamic>>(
      '/assignments/${draft.id}',
      draft.toJson(),
    );
    return AssignmentDraft(
      id: result['id'] as String?,
      title: result['title'] as String? ?? '',
      sectionSubjectId: result['sectionSubjectId'] as String? ?? '',
      marksAvailable: (result['marksAvailable'] as num?)?.toInt() ?? 0,
      dueAt: result['dueAt'] as String? ?? '',
      latePolicy: result['latePolicy'] as String? ?? 'FLAG_ONLY',
      publicationStatus: result['publicationStatus'] as String? ?? 'DRAFT',
      rubricId: result['rubricId'] as String?,
      description: result['description'] as String?,
    );
  }

  Future<void> publishAssignment(String id) async {
    await _api.post<dynamic>(
      '/assignments/$id/publish',
    );
  }

  Future<void> deleteAssignment(String id) async {
    await _api.delete<dynamic>(
      '/assignments/$id',
    );
  }
}
