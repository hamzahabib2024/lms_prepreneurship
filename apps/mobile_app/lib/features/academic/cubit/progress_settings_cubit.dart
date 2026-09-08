import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class ProgressSettingsData {
  const ProgressSettingsData({
    required this.weights,
    required this.criteria,
  });

  final ProgressWeights weights;
  final ProgressCriteria criteria;

  factory ProgressSettingsData.fromJson(Map<String, dynamic> json) {
    final w = json['weights'] as Map<String, dynamic>? ?? {};
    final c = json['criteria'] as Map<String, dynamic>? ?? {};
    return ProgressSettingsData(
      weights: ProgressWeights(
        video: (w['video'] as num?)?.toDouble() ?? 0,
        assignment: (w['assignment'] as num?)?.toDouble() ?? 0,
        quiz: (w['quiz'] as num?)?.toDouble() ?? 0,
        attendance: (w['attendance'] as num?)?.toDouble() ?? 0,
        ownedByThisClass: w['ownedByThisClass'] as bool? ?? false,
      ),
      criteria: ProgressCriteria(
        minProgressPercent: (c['minProgressPercent'] as num?)?.toDouble() ?? 0,
        minAttendancePercent: (c['minAttendancePercent'] as num?)?.toDouble() ?? 0,
        minAverageGradePercent: (c['minAverageGradePercent'] as num?)?.toDouble() ?? 0,
      ),
    );
  }
}

class ProgressWeights {
  const ProgressWeights({
    required this.video,
    required this.assignment,
    required this.quiz,
    required this.attendance,
    this.ownedByThisClass = false,
  });

  final double video;
  final double assignment;
  final double quiz;
  final double attendance;
  final bool ownedByThisClass;

  double get total => video + assignment + quiz + attendance;
}

class ProgressCriteria {
  const ProgressCriteria({
    required this.minProgressPercent,
    required this.minAttendancePercent,
    required this.minAverageGradePercent,
  });

  final double minProgressPercent;
  final double minAttendancePercent;
  final double minAverageGradePercent;
}

class ProgressSettingsCubit extends Cubit<ProgressSettingsState> {
  ProgressSettingsCubit({
    required this.api,
    required this.sectionSubjectId,
  }) : super(const ProgressSettingsState());

  final ApiClient api;
  final String sectionSubjectId;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final json = await api.get<Map<String, dynamic>>(
        '/section-subjects/$sectionSubjectId/progress-settings',
      );
      if (isClosed) return;
      emit(state.copyWith(
        loading: false,
        settings: ProgressSettingsData.fromJson(json),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  Future<void> save({
    required ProgressWeights weights,
    required ProgressCriteria criteria,
  }) async {
    emit(state.copyWith(saving: true, error: null, note: null));
    try {
      await api.put('/section-subjects/$sectionSubjectId/progress-settings', {
        'weights': {
          'video': weights.video,
          'assignment': weights.assignment,
          'quiz': weights.quiz,
          'attendance': weights.attendance,
        },
        'criteria': {
          'minProgressPercent': criteria.minProgressPercent,
          'minAttendancePercent': criteria.minAttendancePercent,
          'minAverageGradePercent': criteria.minAverageGradePercent,
        },
      });
      if (isClosed) return;
      emit(state.copyWith(
        saving: false,
        note: 'Saved. Every figure on this class is measured this way from now on.',
      ));
      load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(saving: false, error: error));
    }
  }

  Future<void> followInstitute() async {
    emit(state.copyWith(saving: true, error: null, note: null));
    try {
      await api.put('/section-subjects/$sectionSubjectId/progress-settings', {});
      if (isClosed) return;
      emit(state.copyWith(
        saving: false,
        note: 'This class follows the Institute again.',
      ));
      load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(saving: false, error: error));
    }
  }
}

class ProgressSettingsState extends Equatable {
  const ProgressSettingsState({
    this.loading = false,
    this.saving = false,
    this.settings,
    this.error,
    this.note,
  });

  final bool loading;
  final bool saving;
  final ProgressSettingsData? settings;
  final ApiException? error;
  final String? note;

  ProgressSettingsState copyWith({
    bool? loading,
    bool? saving,
    ProgressSettingsData? settings,
    ApiException? error,
    String? note,
  }) {
    return ProgressSettingsState(
      loading: loading ?? this.loading,
      saving: saving ?? this.saving,
      settings: settings ?? this.settings,
      error: error,
      note: note,
    );
  }

  @override
  List<Object?> get props => [loading, saving, settings, error, note];
}
