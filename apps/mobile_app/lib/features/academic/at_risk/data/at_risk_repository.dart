import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class AtRiskStudent extends Equatable {
  const AtRiskStudent({
    required this.studentId,
    required this.studentName,
    required this.severity,
    required this.attendancePercent,
    required this.threshold,
    this.lastAction,
    this.lastActionAt,
  });

  final String studentId;
  final String studentName;
  final String severity;
  final double attendancePercent;
  final double threshold;
  final String? lastAction;
  final String? lastActionAt;

  factory AtRiskStudent.fromJson(Map<String, dynamic> json) {
    return AtRiskStudent(
      studentId: json['studentId'] as String,
      studentName: json['studentName'] as String? ?? 'Unknown',
      severity: json['severity'] as String? ?? 'WARNING',
      attendancePercent: (json['attendancePercent'] as num?)?.toDouble() ?? 0,
      threshold: (json['threshold'] as num?)?.toDouble() ?? 0,
      lastAction: json['lastAction'] as String?,
      lastActionAt: json['lastActionAt'] as String?,
    );
  }

  @override
  List<Object?> get props => [
        studentId, studentName, severity, attendancePercent,
        threshold, lastAction, lastActionAt,
      ];
}

class AtRiskState extends Equatable {
  const AtRiskState({
    this.status = AtRiskStatus.loading,
    this.students = const [],
    this.error,
  });

  final AtRiskStatus status;
  final List<AtRiskStudent> students;
  final ApiException? error;

  AtRiskState copyWith({
    AtRiskStatus? status,
    List<AtRiskStudent>? students,
    ApiException? error,
  }) {
    return AtRiskState(
      status: status ?? this.status,
      students: students ?? this.students,
      error: error ?? this.error,
    );
  }

  @override
  List<Object?> get props => [status, students, error];
}

enum AtRiskStatus { loading, loaded, failure }

class AtRiskCubit extends Cubit<AtRiskState> {
  AtRiskCubit(this._api) : super(const AtRiskState());

  final ApiClient _api;

  Future<void> load(String sectionSubjectId) async {
    emit(state.copyWith(status: AtRiskStatus.loading));
    try {
      final data = await _api.get<List<dynamic>>(
        '/section-subjects/$sectionSubjectId/at-risk',
      );
      final students = data
          .whereType<Map<String, dynamic>>()
          .map(AtRiskStudent.fromJson)
          .toList();
      emit(state.copyWith(
        status: AtRiskStatus.loaded,
        students: students,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: AtRiskStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> acknowledge({
    required String sectionSubjectId,
    required String studentId,
    required String action,
  }) async {
    try {
      await _api.post<void>(
        '/section-subjects/$sectionSubjectId/at-risk/$studentId/acknowledge',
        {'action': action},
      );
      await load(sectionSubjectId);
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }
}
