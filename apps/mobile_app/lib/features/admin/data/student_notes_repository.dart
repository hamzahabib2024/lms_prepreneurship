import '../../../core/network/api_client.dart';
import '../data/models/student_notes.dart';

class StudentNotesRepository {
  const StudentNotesRepository(this._api);
  final ApiClient _api;

  Future<List<StudentNote>> listNotes(String studentId) async {
    final data = await _api.get<List<dynamic>>('/students/$studentId/notes');
    return data
        .whereType<Map<String, dynamic>>()
        .map((j) => StudentNote(
              id: j['id'] as String,
              studentId: j['studentId'] as String? ?? studentId,
              body: j['body'] as String? ?? '',
              authorName: j['authorName'] as String? ?? 'Unknown',
              createdAt: DateTime.parse(j['createdAt'] as String),
              updatedAt: j['updatedAt'] != null
                  ? DateTime.parse(j['updatedAt'] as String)
                  : null,
            ))
        .toList();
  }

  Future<void> createNote({
    required String studentId,
    required String body,
  }) async {
    await _api.post<void>('/students/$studentId/notes', {'body': body});
  }

  Future<void> updateNote({
    required String noteId,
    required String body,
  }) async {
    await _api.patch<void>('/student-notes/$noteId', {'body': body});
  }

  Future<void> deleteNote({required String noteId}) async {
    await _api.delete<void>('/student-notes/$noteId');
  }
}
