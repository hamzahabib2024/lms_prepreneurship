/// Issuing to a whole batch — SRS §9.10, FR-CRT.
library;

class BatchIssueResult {
  const BatchIssueResult({
    required this.considered,
    required this.issued,
    required this.issuedOverRequirements,
    required this.alreadyHeld,
    required this.skipped,
    required this.students,
  });

  final int considered;
  final int issued;

  /// The office overruling the requirements check. Counted separately from
  /// [issued] because each of these certificates records that it was issued
  /// over the requirements, and by whom.
  final int issuedOverRequirements;

  /// Left alone. Nothing is ever issued twice.
  final int alreadyHeld;
  final int skipped;

  final List<BatchIssueStudent> students;

  int get total => issued + issuedOverRequirements;

  /// NAMED, NOT COUNTED. "3 skipped" tells the office to go looking; the list
  /// tells them where.
  List<BatchIssueStudent> get skippedStudents =>
      students.where((s) => s.outcome == 'SKIPPED').toList();

  /// The sentence under the headline figure.
  String describe() {
    final parts = <String>[
      '$issued met the requirements',
      if (issuedOverRequirements > 0)
        '$issuedOverRequirements issued over them',
      if (alreadyHeld > 0) '$alreadyHeld already held one',
      if (skipped > 0) '$skipped skipped',
    ];
    return '${parts.join(', ')}.';
  }

  factory BatchIssueResult.fromJson(Map<String, dynamic> json) {
    final summary = (json['summary'] as Map<String, dynamic>?) ?? const {};
    return BatchIssueResult(
      considered: summary['considered'] as int? ?? 0,
      issued: summary['issued'] as int? ?? 0,
      issuedOverRequirements: summary['issuedOverRequirements'] as int? ?? 0,
      alreadyHeld: summary['alreadyHeld'] as int? ?? 0,
      skipped: summary['skipped'] as int? ?? 0,
      students: (json['students'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(BatchIssueStudent.fromJson)
          .toList(),
    );
  }
}

class BatchIssueStudent {
  const BatchIssueStudent({
    required this.studentId,
    required this.name,
    required this.outcome,
    required this.message,
  });

  final String studentId;
  final String name;

  /// ISSUED, ISSUED_OVER_REQUIREMENTS, ALREADY_HELD or SKIPPED.
  final String outcome;

  /// Why, for the ones that were skipped.
  final String? message;

  factory BatchIssueStudent.fromJson(Map<String, dynamic> json) {
    return BatchIssueStudent(
      studentId: json['studentId'] as String? ?? '',
      name: json['name'] as String? ?? 'Unknown student',
      outcome: json['outcome'] as String? ?? 'SKIPPED',
      message: json['message'] as String?,
    );
  }
}
