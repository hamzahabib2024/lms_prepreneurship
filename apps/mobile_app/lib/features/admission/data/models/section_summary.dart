import 'package:equatable/equatable.dart';

/// A section the reviewer can assign to (GET /sections) — FR-CRS-010: occupancy,
/// capacity and remaining places wherever a section appears.
class SectionSummary extends Equatable {
  const SectionSummary({
    required this.id,
    required this.code,
    required this.name,
    required this.capacity,
    required this.enrolledCount,
    required this.placesRemaining,
    required this.isFull,
    required this.genderRestriction,
  });

  final String id;
  final String code;
  final String name;
  final int capacity;
  final int enrolledCount;
  final int placesRemaining;
  final bool isFull;
  final String genderRestriction;

  factory SectionSummary.fromJson(Map<String, dynamic> json) {
    return SectionSummary(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      capacity: (json['capacity'] as num?)?.toInt() ?? 0,
      enrolledCount: (json['enrolledCount'] as num?)?.toInt() ?? 0,
      placesRemaining: (json['placesRemaining'] as num?)?.toInt() ?? 0,
      isFull: json['isFull'] as bool? ?? false,
      genderRestriction: json['genderRestriction'] as String? ?? 'MIXED',
    );
  }

  @override
  List<Object?> get props => [
        id, code, name, capacity, enrolledCount, placesRemaining, isFull,
        genderRestriction,
      ];
}
