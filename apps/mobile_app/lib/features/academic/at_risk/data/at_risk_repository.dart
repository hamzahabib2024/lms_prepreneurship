import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';

/// One student below the attendance requirement — FR-ATT-020/022.
///
/// A WARNING IS A ROW WITH AN IDENTITY, not a property of the student. The
/// server raises one, and acknowledging it acts on that warning by its own id
/// — which is why `warningId` is the field this class is really about.
class AtRiskStudent extends Equatable {
  const AtRiskStudent({
    required this.warningId,
    required this.studentId,
    required this.rollNo,
    required this.name,
    required this.severity,
    required this.percentage,
    required this.thresholdApplied,
    required this.raisedAt,
    required this.acknowledgedAt,
  });

  final String warningId;
  final String studentId;
  final int? rollNo;
  final String name;

  /// WARNING or CRITICAL.
  final String severity;
  final double percentage;
  final double thresholdApplied;
  final DateTime raisedAt;

  /// When somebody recorded that they had acted. Deliberately not "resolved":
  /// the student is still below the threshold, and the warning clears when
  /// their attendance recovers, not when a teacher speaks to them.
  final DateTime? acknowledgedAt;

  bool get isCritical => severity == 'CRITICAL';
  bool get isActioned => acknowledgedAt != null;

  int get daysSinceRaised => DateTime.now().difference(raisedAt).inDays;

  factory AtRiskStudent.fromJson(Map<String, dynamic> json) {
    final acknowledged = json['acknowledgedAt'] as String?;
    return AtRiskStudent(
      warningId: json['warningId'] as String,
      studentId: json['studentId'] as String? ?? '',
      rollNo: json['rollNo'] as int?,
      name: json['name'] as String? ?? 'Unknown',
      severity: json['severity'] as String? ?? 'WARNING',
      percentage: (json['percentage'] as num?)?.toDouble() ?? 0,
      thresholdApplied: (json['thresholdApplied'] as num?)?.toDouble() ?? 0,
      raisedAt: DateTime.parse(json['raisedAt'] as String).toLocal(),
      acknowledgedAt: acknowledged == null
          ? null
          : DateTime.tryParse(acknowledged)?.toLocal(),
    );
  }

  @override
  List<Object?> get props => [
        warningId,
        studentId,
        rollNo,
        name,
        severity,
        percentage,
        thresholdApplied,
        raisedAt,
        acknowledgedAt,
      ];
}

class AtRiskState extends Equatable {
  const AtRiskState({
    this.status = AtRiskStatus.loading,
    this.students = const [],
    this.critical = 0,
    this.warning = 0,
    this.unacknowledged = 0,
    this.busyWarningId,
    this.error,
  });

  final AtRiskStatus status;
  final List<AtRiskStudent> students;
  final int critical;
  final int warning;

  /// Raised and nobody has acted. The figure the panel exists for.
  final int unacknowledged;

  final String? busyWarningId;
  final ApiException? error;

  /// UNACKNOWLEDGED FIRST, THEN WORST, THEN LONGEST-STANDING.
  ///
  /// A critical warning raised three weeks ago that nobody has touched is the
  /// one that matters, and any ordering that buries it defeats the purpose of
  /// an early-warning signal.
  List<AtRiskStudent> get ordered {
    final sorted = [...students];
    sorted.sort((a, b) {
      final actioned = (a.isActioned ? 1 : 0) - (b.isActioned ? 1 : 0);
      if (actioned != 0) return actioned;
      if (a.isCritical != b.isCritical) return a.isCritical ? -1 : 1;
      return a.raisedAt.compareTo(b.raisedAt);
    });
    return sorted;
  }

  AtRiskState copyWith({
    AtRiskStatus? status,
    List<AtRiskStudent>? students,
    int? critical,
    int? warning,
    int? unacknowledged,
    String? busyWarningId,
    ApiException? error,
    bool clearBusy = false,
    bool clearError = false,
  }) {
    return AtRiskState(
      status: status ?? this.status,
      students: students ?? this.students,
      critical: critical ?? this.critical,
      warning: warning ?? this.warning,
      unacknowledged: unacknowledged ?? this.unacknowledged,
      busyWarningId: clearBusy ? null : (busyWarningId ?? this.busyWarningId),
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  List<Object?> get props =>
      [status, students, critical, warning, unacknowledged, busyWarningId, error];
}

enum AtRiskStatus { loading, loaded, failure }

class AtRiskCubit extends Cubit<AtRiskState> {
  AtRiskCubit(this._api) : super(const AtRiskState());

  final ApiClient _api;

  Future<void> load(String sectionSubjectId) async {
    emit(state.copyWith(status: AtRiskStatus.loading, clearError: true));
    try {
      final data = await _api.get<Map<String, dynamic>>(
        '/section-subjects/$sectionSubjectId/at-risk',
      );
      if (isClosed) return;
      emit(state.copyWith(
        status: AtRiskStatus.loaded,
        students: (data['students'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(AtRiskStudent.fromJson)
            .toList(),
        critical: data['critical'] as int? ?? 0,
        warning: data['warning'] as int? ?? 0,
        unacknowledged: data['unacknowledged'] as int? ?? 0,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: AtRiskStatus.failure, error: e));
    }
  }

  /// FR-ATT-022 — record that somebody has acted on this warning.
  ///
  /// The warning is acted on by ITS OWN ID, not by student and class: the
  /// same student can be below the requirement in two subjects, and each is a
  /// separate warning somebody has to answer for separately.
  ///
  /// [note] is optional. What was done is worth recording and is not worth
  /// blocking on — a teacher who spoke to a student in the corridor should
  /// not have to write an essay before the System will believe them.
  Future<bool> acknowledge({
    required String sectionSubjectId,
    required String warningId,
    String? note,
  }) async {
    emit(state.copyWith(busyWarningId: warningId, clearError: true));
    try {
      await _api.post<dynamic>(
        '/attendance-warnings/$warningId/acknowledge',
        {'note': ?(note == null || note.trim().isEmpty ? null : note.trim())},
      );
      if (isClosed) return false;
      emit(state.copyWith(clearBusy: true));
      await load(sectionSubjectId);
      return true;
    } on ApiException catch (e) {
      if (isClosed) return false;
      emit(state.copyWith(clearBusy: true, error: e));
      return false;
    }
  }
}
