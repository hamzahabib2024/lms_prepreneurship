import 'package:equatable/equatable.dart';

/// FR-REG-002 — what a stranger can apply for (GET /public/prospectus).
///
/// Deliberately thin: no counts, no names, no capacity — only what is open.
class ProspectusProgramme extends Equatable {
  const ProspectusProgramme({
    required this.id,
    required this.name,
    required this.code,
    required this.description,
    required this.durationWeeks,
    required this.sections,
  });

  final String id;
  final String name;
  final String code;
  final String? description;
  final int? durationWeeks;
  final List<ProspectusSection> sections;

  factory ProspectusProgramme.fromJson(Map<String, dynamic> json) {
    return ProspectusProgramme(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
      description: json['description'] as String?,
      durationWeeks: json['durationWeeks'] as int?,
      sections: (json['sections'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ProspectusSection.fromJson)
          .toList(),
    );
  }

  @override
  List<Object?> get props => [id, name, code, description, durationWeeks, sections];
}

class ProspectusSection extends Equatable {
  const ProspectusSection({
    required this.id,
    required this.name,
    required this.code,
    required this.shift,
    required this.genderRestriction,
    required this.session,
  });

  final String id;
  final String name;
  final String code;
  final String shift;
  final String genderRestriction;
  final String session;

  factory ProspectusSection.fromJson(Map<String, dynamic> json) {
    return ProspectusSection(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
      shift: json['shift'] as String? ?? '',
      genderRestriction: json['genderRestriction'] as String? ?? 'MIXED',
      session: json['session'] as String? ?? '',
    );
  }

  bool get isGenderRestricted => genderRestriction != 'MIXED';

  @override
  List<Object?> get props => [id, name, code, shift, genderRestriction, session];
}
