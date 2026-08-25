import 'package:equatable/equatable.dart';

class PreviewRow extends Equatable {
  const PreviewRow({
    required this.line,
    required this.fullName,
    required this.email,
    required this.gender,
    this.returningWith,
    this.blocked,
  });

  final int line;
  final String fullName;
  final String email;
  final String gender;
  final String? returningWith;
  final String? blocked;

  factory PreviewRow.fromJson(Map<String, dynamic> json) {
    return PreviewRow(
      line: json['line'] as int,
      fullName: json['fullName'] as String,
      email: json['email'] as String,
      gender: json['gender'] as String,
      returningWith: json['returningWith'] as String?,
      blocked: json['blocked'] as String?,
    );
  }

  @override
  List<Object?> get props => [line, fullName, email, gender, returningWith, blocked];
}

class PreviewSection extends Equatable {
  const PreviewSection({
    required this.id,
    required this.name,
    this.genderRestriction,
    this.capacity,
    this.enrolledCount,
  });

  final String id;
  final String name;
  final String? genderRestriction;
  final int? capacity;
  final int? enrolledCount;

  factory PreviewSection.fromJson(Map<String, dynamic> json) {
    return PreviewSection(
      id: json['id'] as String,
      name: json['name'] as String,
      genderRestriction: json['genderRestriction'] as String?,
      capacity: json['capacity'] as int?,
      enrolledCount: json['enrolledCount'] as int?,
    );
  }

  @override
  List<Object?> get props => [id, name, genderRestriction, capacity, enrolledCount];
}

class RowProblem extends Equatable {
  const RowProblem({
    required this.line,
    required this.field,
    required this.message,
  });

  final int line;
  final String field;
  final String message;

  factory RowProblem.fromJson(Map<String, dynamic> json) {
    return RowProblem(
      line: json['line'] as int,
      field: json['field'] as String,
      message: json['message'] as String,
    );
  }

  @override
  List<Object?> get props => [line, field, message];
}

class FileProblem extends Equatable {
  const FileProblem({required this.code, required this.message});
  final String code;
  final String message;

  factory FileProblem.fromJson(Map<String, dynamic> json) {
    return FileProblem(
      code: json['code'] as String,
      message: json['message'] as String,
    );
  }

  @override
  List<Object?> get props => [code, message];
}

class ImportPreview extends Equatable {
  const ImportPreview({
    this.section,
    this.fileProblem,
    this.unknownColumns = const [],
    this.rowProblems = const [],
    this.rows = const [],
    this.wouldLoad = 0,
    this.wouldRejoin = 0,
    this.capacityWarning,
    this.message = '',
  });

  final PreviewSection? section;
  final FileProblem? fileProblem;
  final List<String> unknownColumns;
  final List<RowProblem> rowProblems;
  final List<PreviewRow> rows;
  final int wouldLoad;
  final int wouldRejoin;
  final String? capacityWarning;
  final String message;

  factory ImportPreview.fromJson(Map<String, dynamic> json) {
    return ImportPreview(
      section: json['section'] != null
          ? PreviewSection.fromJson(json['section'] as Map<String, dynamic>)
          : null,
      fileProblem: json['fileProblem'] != null
          ? FileProblem.fromJson(json['fileProblem'] as Map<String, dynamic>)
          : null,
      unknownColumns: (json['unknownColumns'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          [],
      rowProblems: (json['rowProblems'] as List<dynamic>?)
              ?.map((e) => RowProblem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      rows: (json['rows'] as List<dynamic>?)
              ?.map((e) => PreviewRow.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      wouldLoad: json['wouldLoad'] as int? ?? 0,
      wouldRejoin: json['wouldRejoin'] as int? ?? 0,
      capacityWarning: json['capacityWarning'] as String?,
      message: json['message'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [
        section,
        fileProblem,
        unknownColumns,
        rowProblems,
        rows,
        wouldLoad,
        wouldRejoin,
        capacityWarning,
        message,
      ];
}

// ── Commit result ──

class ImportOutcome extends Equatable {
  const ImportOutcome({
    required this.line,
    required this.fullName,
    required this.email,
    required this.status,
    this.registrationNo,
    this.rollNo,
    this.reason,
    this.temporaryPassword,
    this.emailSent,
  });

  final int line;
  final String fullName;
  final String email;
  final String status;
  final String? registrationNo;
  final int? rollNo;
  final String? reason;
  final String? temporaryPassword;
  final bool? emailSent;

  factory ImportOutcome.fromJson(Map<String, dynamic> json) {
    return ImportOutcome(
      line: json['line'] as int,
      fullName: json['fullName'] as String,
      email: json['email'] as String,
      status: json['status'] as String,
      registrationNo: json['registrationNo'] as String?,
      rollNo: json['rollNo'] as int?,
      reason: json['reason'] as String?,
      temporaryPassword: json['temporaryPassword'] as String?,
      emailSent: json['emailSent'] as bool?,
    );
  }

  @override
  List<Object?> get props => [
        line,
        fullName,
        email,
        status,
        registrationNo,
        rollNo,
        reason,
        temporaryPassword,
        emailSent,
      ];
}

class ImportResult extends Equatable {
  const ImportResult({
    required this.sectionId,
    required this.sectionName,
    required this.loaded,
    required this.rejoined,
    required this.skipped,
    this.outcomes = const [],
    this.emailed = 0,
    this.notEmailed = 0,
    this.message = '',
  });

  final String sectionId;
  final String sectionName;
  final int loaded;
  final int rejoined;
  final int skipped;
  final List<ImportOutcome> outcomes;
  final int emailed;
  final int notEmailed;
  final String message;

  factory ImportResult.fromJson(Map<String, dynamic> json) {
    return ImportResult(
      sectionId: json['sectionId'] as String,
      sectionName: json['sectionName'] as String,
      loaded: json['loaded'] as int,
      rejoined: json['rejoined'] as int,
      skipped: json['skipped'] as int,
      outcomes: (json['outcomes'] as List<dynamic>?)
              ?.map((e) => ImportOutcome.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      emailed: json['emailed'] as int? ?? 0,
      notEmailed: json['notEmailed'] as int? ?? 0,
      message: json['message'] as String? ?? '',
    );
  }

  @override
  List<Object?> get props => [
        sectionId,
        sectionName,
        loaded,
        rejoined,
        skipped,
        outcomes,
        emailed,
        notEmailed,
        message,
      ];
}

// ── Section list item ──

class CohortSection extends Equatable {
  const CohortSection({
    required this.id,
    required this.name,
    this.genderRestriction,
    this.capacity,
    this.enrolledCount,
  });

  final String id;
  final String name;
  final String? genderRestriction;
  final int? capacity;
  final int? enrolledCount;

  factory CohortSection.fromJson(Map<String, dynamic> json) {
    return CohortSection(
      id: json['id'] as String,
      name: json['name'] as String,
      genderRestriction: json['genderRestriction'] as String?,
      capacity: json['capacity'] as int?,
      enrolledCount: json['enrolledCount'] as int?,
    );
  }

  @override
  List<Object?> get props => [id, name, genderRestriction, capacity, enrolledCount];
}
