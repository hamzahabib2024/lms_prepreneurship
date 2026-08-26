import 'package:equatable/equatable.dart';

// ── Programme (Course) ──

class ProgrammeSubject extends Equatable {
  const ProgrammeSubject({
    required this.id,
    required this.code,
    required this.name,
    this.batches = 0,
  });

  final String id;
  final String code;
  final String name;
  final int batches;

  factory ProgrammeSubject.fromJson(Map<String, dynamic> json) {
    return ProgrammeSubject(
      id: json['id'] as String,
      code: json['code'] as String,
      name: json['name'] as String,
      batches: json['batches'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [id, code, name, batches];
}

class ProgrammeBatch extends Equatable {
  const ProgrammeBatch({
    required this.id,
    required this.name,
    this.capacity = 0,
    this.enrolledCount = 0,
    this.shift,
    this.genderRestriction,
    this.deliveryMode,
    this.teacherName,
  });

  final String id;
  final String name;
  final int capacity;
  final int enrolledCount;
  final String? shift;
  final String? genderRestriction;
  final String? deliveryMode;
  final String? teacherName;

  factory ProgrammeBatch.fromJson(Map<String, dynamic> json) {
    return ProgrammeBatch(
      id: json['id'] as String,
      name: json['name'] as String,
      capacity: json['capacity'] as int? ?? 0,
      enrolledCount: json['enrolledCount'] as int? ?? 0,
      shift: json['shift'] as String?,
      genderRestriction: json['genderRestriction'] as String?,
      deliveryMode: json['deliveryMode'] as String?,
      teacherName: json['teacherName'] as String?,
    );
  }

  @override
  List<Object?> get props => [id, name, capacity, enrolledCount, shift, genderRestriction, deliveryMode, teacherName];
}

class ProgrammeFee extends Equatable {
  const ProgrammeFee({this.published = false, this.drafts = 0});
  final bool published;
  final int drafts;

  factory ProgrammeFee.fromJson(Map<String, dynamic> json) {
    return ProgrammeFee(
      published: json['published'] as bool? ?? false,
      drafts: json['drafts'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [published, drafts];
}

class ProgrammeTotals extends Equatable {
  const ProgrammeTotals({this.batches = 0, this.seats = 0, this.enrolled = 0});
  final int batches;
  final int seats;
  final int enrolled;

  factory ProgrammeTotals.fromJson(Map<String, dynamic> json) {
    return ProgrammeTotals(
      batches: json['batches'] as int? ?? 0,
      seats: json['seats'] as int? ?? 0,
      enrolled: json['enrolled'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [batches, seats, enrolled];
}

class Programme extends Equatable {
  const Programme({
    required this.id,
    required this.name,
    required this.code,
    this.description,
    this.durationWeeks,
    this.thumbnailAssetId,
    this.isActive = true,
    this.subjects = const [],
    this.unlistedSubjects = const [],
    this.batches = const [],
    this.totals,
    this.fee,
  });

  final String id;
  final String name;
  final String code;
  final String? description;
  final int? durationWeeks;
  final String? thumbnailAssetId;
  final bool isActive;
  final List<ProgrammeSubject> subjects;
  final List<ProgrammeSubject> unlistedSubjects;
  final List<ProgrammeBatch> batches;
  final ProgrammeTotals? totals;
  final ProgrammeFee? fee;

  factory Programme.fromJson(Map<String, dynamic> json) {
    return Programme(
      id: json['id'] as String,
      name: json['name'] as String,
      code: json['code'] as String,
      description: json['description'] as String?,
      durationWeeks: json['durationWeeks'] as int?,
      thumbnailAssetId: json['thumbnailAssetId'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      subjects: (json['subjects'] as List<dynamic>?)
              ?.map((e) => ProgrammeSubject.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      unlistedSubjects: (json['unlistedSubjects'] as List<dynamic>?)
              ?.map((e) => ProgrammeSubject.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      batches: (json['batches'] as List<dynamic>?)
              ?.map((e) => ProgrammeBatch.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      totals: json['totals'] != null
          ? ProgrammeTotals.fromJson(json['totals'] as Map<String, dynamic>)
          : null,
      fee: json['fee'] != null
          ? ProgrammeFee.fromJson(json['fee'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [id, name, code, description, durationWeeks, thumbnailAssetId, isActive, subjects, unlistedSubjects, batches, totals, fee];
}

// ── Subject ──

class Subject extends Equatable {
  const Subject({
    required this.id,
    required this.name,
    required this.code,
    this.description,
    this.credits,
    this.thumbnailAssetId,
    this.thumbnailUrl,
    this.isActive = true,
  });

  final String id;
  final String name;
  final String code;
  final String? description;
  final int? credits;
  final String? thumbnailAssetId;
  final String? thumbnailUrl;
  final bool isActive;

  factory Subject.fromJson(Map<String, dynamic> json) {
    return Subject(
      id: json['id'] as String,
      name: json['name'] as String,
      code: json['code'] as String,
      description: json['description'] as String?,
      credits: json['credits'] as int?,
      thumbnailAssetId: json['thumbnailAssetId'] as String?,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  @override
  List<Object?> get props => [id, name, code, description, credits, thumbnailAssetId, thumbnailUrl, isActive];
}

// ── Fee Structure ──

class FeeLine extends Equatable {
  const FeeLine({
    required this.kind,
    required this.label,
    required this.amount,
    this.dueAfterDays,
    this.sortOrder = 0,
  });

  final String kind;
  final String label;
  final double amount;
  final int? dueAfterDays;
  final int sortOrder;

  factory FeeLine.fromJson(Map<String, dynamic> json) {
    return FeeLine(
      kind: json['kind'] as String,
      label: json['label'] as String,
      amount: (json['amount'] as num).toDouble(),
      dueAfterDays: json['dueAfterDays'] as int?,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [kind, label, amount, dueAfterDays, sortOrder];
}

class FeeStructure extends Equatable {
  const FeeStructure({
    required this.id,
    required this.programmeId,
    required this.name,
    this.currency = 'PKR',
    this.totalAmount = 0,
    this.dueAtApplication = 0,
    this.notes,
    this.status = 'DRAFT',
    this.lines = const [],
  });

  final String id;
  final String programmeId;
  final String name;
  final String currency;
  final double totalAmount;
  final double dueAtApplication;
  final String? notes;
  final String status;
  final List<FeeLine> lines;

  factory FeeStructure.fromJson(Map<String, dynamic> json) {
    return FeeStructure(
      id: json['id'] as String,
      programmeId: json['programmeId'] as String,
      name: json['name'] as String,
      currency: json['currency'] as String? ?? 'PKR',
      totalAmount: (json['totalAmount'] as num?)?.toDouble() ?? 0,
      dueAtApplication: (json['dueAtApplication'] as num?)?.toDouble() ?? 0,
      notes: json['notes'] as String?,
      status: json['status'] as String? ?? 'DRAFT',
      lines: (json['lines'] as List<dynamic>?)
              ?.map((e) => FeeLine.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  @override
  List<Object?> get props => [id, programmeId, name, currency, totalAmount, dueAtApplication, notes, status, lines];
}

// ── Teacher (for batch assignment) ──

class Teacher extends Equatable {
  const Teacher({
    required this.id,
    required this.name,
    this.currentSections = 0,
    this.currentStudents = 0,
  });

  final String id;
  final String name;
  final int currentSections;
  final int currentStudents;

  factory Teacher.fromJson(Map<String, dynamic> json) {
    return Teacher(
      id: json['id'] as String,
      name: json['name'] as String,
      currentSections: json['currentSections'] as int? ?? 0,
      currentStudents: json['currentStudents'] as int? ?? 0,
    );
  }

  @override
  List<Object?> get props => [id, name, currentSections, currentStudents];
}
