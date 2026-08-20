/// Academic structure models — SRS §5.3: programme → term → batch → section.
///
/// The shapes mirror what the web client reads from the same endpoints, and
/// nothing here invents a field the API does not send.
library;

class ProgrammeBrief {
  const ProgrammeBrief({required this.id, required this.code, required this.name});

  final String id;
  final String code;
  final String name;

  factory ProgrammeBrief.fromJson(Map<String, dynamic> json) => ProgrammeBrief(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );
}

class Programme {
  const Programme({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.durationWeeks,
    required this.sessions,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final int? durationWeeks;
  final int sessions;

  factory Programme.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>? ?? const {};
    return Programme(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String?,
      durationWeeks: json['durationWeeks'] as int?,
      sessions: count['sessions'] as int? ?? 0,
    );
  }
}

class AcademicSession {
  const AcademicSession({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    this.startDate,
    this.endDate,
    required this.programme,
    required this.batches,
  });

  final String id;
  final String code;
  final String name;
  final String status;
  final DateTime? startDate;
  final DateTime? endDate;
  final ProgrammeBrief programme;
  final int batches;

  factory AcademicSession.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>? ?? const {};
    return AcademicSession(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? '',
      startDate: DateTime.tryParse(json['startDate'] as String? ?? ''),
      endDate: DateTime.tryParse(json['endDate'] as String? ?? ''),
      programme: ProgrammeBrief.fromJson(json['programme'] as Map<String, dynamic>? ?? const {}),
      batches: count['batches'] as int? ?? 0,
    );
  }
}

class Batch {
  const Batch({
    required this.id,
    required this.name,
    required this.deliveryPattern,
    required this.session,
    required this.sections,
  });

  final String id;
  final String name;
  final String deliveryPattern;
  final SessionBrief session;
  final int sections;

  factory Batch.fromJson(Map<String, dynamic> json) {
    final count = json['_count'] as Map<String, dynamic>? ?? const {};
    return Batch(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      deliveryPattern: json['deliveryPattern'] as String? ?? '',
      session: SessionBrief.fromJson(
          json['academicSession'] as Map<String, dynamic>? ?? const {}),
      sections: count['sections'] as int? ?? 0,
    );
  }
}

class SessionBrief {
  const SessionBrief({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    required this.programme,
  });

  final String id;
  final String code;
  final String name;
  final String status;
  final ProgrammeBrief programme;

  factory SessionBrief.fromJson(Map<String, dynamic> json) => SessionBrief(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String? ?? '',
        programme: ProgrammeBrief.fromJson(json['programme'] as Map<String, dynamic>? ?? const {}),
      );
}