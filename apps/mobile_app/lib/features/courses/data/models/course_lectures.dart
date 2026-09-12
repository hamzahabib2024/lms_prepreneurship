/// The lectures for a specific class (section-subject), with per-lecture
/// watch state — maps `GET /section-subjects/:id/lectures`.
class CourseLectures {
  const CourseLectures({
    required this.subject,
    required this.section,
    this.canManage = false,
    this.lectures = const [],
    this.meetingUrl,
    this.meetingNote,
    this.lectureFolderRef,
  });

  final CourseLectureSubject subject;
  final CourseLectureSection section;
  final bool canManage;
  final List<CourseLecture> lectures;

  /// THE CLASS'S ROOM — one link, used every week (FR-LIV).
  ///
  /// It belongs to the subject INSIDE the section: two sections of the same
  /// course are two classes meeting at two different times, and a link on the
  /// course would send both to the same room. The server has always sent
  /// these two fields; the model simply did not read them.
  final String? meetingUrl;
  final String? meetingNote;

  /// Staff only — a student has no business knowing where the files live.
  final String? lectureFolderRef;

  factory CourseLectures.fromJson(Map<String, dynamic> json) =>
      CourseLectures(
        subject: CourseLectureSubject.fromJson(
            json['subject'] as Map<String, dynamic>? ?? const {}),
        section: CourseLectureSection.fromJson(
            json['section'] as Map<String, dynamic>? ?? const {}),
        canManage: json['canManage'] as bool? ?? false,
        lectures: (json['lectures'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CourseLecture.fromJson)
            .toList(),
        meetingUrl: json['meetingUrl'] as String?,
        meetingNote: json['meetingNote'] as String?,
        lectureFolderRef: json['lectureFolderRef'] as String?,
      );
}

class CourseLectureSubject {
  const CourseLectureSubject({
    required this.id,
    required this.code,
    required this.name,
  });

  final String id;
  final String code;
  final String name;

  factory CourseLectureSubject.fromJson(Map<String, dynamic> json) =>
      CourseLectureSubject(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

class CourseLectureSection {
  const CourseLectureSection({
    required this.code,
    required this.name,
  });

  final String code;
  final String name;

  factory CourseLectureSection.fromJson(Map<String, dynamic> json) =>
      CourseLectureSection(
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

class CourseLecture {
  const CourseLecture({
    required this.id,
    required this.title,
    this.description,
    this.durationSeconds,
    this.recordedOn = '',
    this.publicationStatus = 'DRAFT',
    this.availabilityStatus = 'MISSING',
    this.watch,
  });

  final String id;
  final String title;
  final String? description;
  final int? durationSeconds;
  final String recordedOn;
  final String publicationStatus;
  final String availabilityStatus;
  final LectureWatchState? watch;

  bool get isAvailable => availabilityStatus == 'AVAILABLE';

  factory CourseLecture.fromJson(Map<String, dynamic> json) => CourseLecture(
        id: json['id'] as String? ?? '',
        title: json['title'] as String? ?? '',
        description: json['description'] as String?,
        durationSeconds: json['durationSeconds'] as int?,
        recordedOn: json['recordedOn'] as String? ?? '',
        publicationStatus:
            json['publicationStatus'] as String? ?? 'DRAFT',
        availabilityStatus:
            json['availabilityStatus'] as String? ?? 'MISSING',
        watch: json['watch'] != null
            ? LectureWatchState.fromJson(
                json['watch'] as Map<String, dynamic>)
            : null,
      );
}

class LectureWatchState {
  const LectureWatchState({
    this.watchedPercent = 0,
    this.lastPositionSeconds = 0,
    this.isComplete = false,
  });

  final double watchedPercent;
  final int lastPositionSeconds;
  final bool isComplete;

  factory LectureWatchState.fromJson(Map<String, dynamic> json) =>
      LectureWatchState(
        watchedPercent: (json['watchedPercent'] as num?)?.toDouble() ?? 0,
        lastPositionSeconds: json['lastPositionSeconds'] as int? ?? 0,
        isComplete: json['isComplete'] as bool? ?? false,
      );
}
