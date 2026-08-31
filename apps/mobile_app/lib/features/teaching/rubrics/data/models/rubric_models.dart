/// Models for the rubrics domain — SRS §13.6, FR-TCH-021.
library;

class Rubric {
  const Rubric({
    required this.id,
    required this.title,
    required this.type,
    required this.createdAt,
    required this.createdBy,
    required this.criteria,
    this.description,
    this.isShared = false,
    this.isMine = true,
    this.criteriaCount = 0,
    this.totalMarks = 0,
    this.usedByAssignments = 0,
  });

  final String id;
  final String title;
  final String type;
  final String createdAt;
  final String createdBy;
  final List<RubricCriterion> criteria;
  final String? description;
  final bool isShared;
  final bool isMine;
  final int criteriaCount;
  final num totalMarks;
  final int usedByAssignments;

  factory Rubric.fromJson(Map<String, dynamic> json) {
    return Rubric(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      type: json['type'] as String? ?? 'CUSTOM',
      createdAt: json['createdAt'] as String? ?? '',
      createdBy: json['createdBy'] as String? ?? '',
      criteria: (json['criteria'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RubricCriterion.fromJson)
          .toList(),
      description: json['description'] as String?,
      isShared: json['isShared'] as bool? ?? false,
      isMine: json['isMine'] as bool? ?? true,
      criteriaCount: (json['criteriaCount'] as num?)?.toInt() ?? 0,
      totalMarks: json['totalMarks'] as num? ?? 0,
      usedByAssignments: (json['usedByAssignments'] as num?)?.toInt() ?? 0,
    );
  }
}

class RubricCriterion {
  const RubricCriterion({
    required this.id,
    required this.description,
    required this.weight,
    required this.levels,
  });

  final String id;
  final String description;
  final num weight;
  final List<RubricLevel> levels;

  factory RubricCriterion.fromJson(Map<String, dynamic> json) {
    return RubricCriterion(
      id: json['id'] as String? ?? '',
      description: json['description'] as String? ?? '',
      weight: json['weight'] as num? ?? 0,
      levels: (json['levels'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(RubricLevel.fromJson)
          .toList(),
    );
  }
}

class RubricLevel {
  const RubricLevel({
    required this.id,
    required this.label,
    required this.description,
    required this.marks,
  });

  final String id;
  final String label;
  final String description;
  final num marks;

  factory RubricLevel.fromJson(Map<String, dynamic> json) {
    return RubricLevel(
      id: json['id'] as String? ?? '',
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
      marks: json['marks'] as num? ?? 0,
    );
  }
}
