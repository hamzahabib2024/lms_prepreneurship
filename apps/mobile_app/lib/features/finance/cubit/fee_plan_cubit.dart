import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class FeeInstalment {
  const FeeInstalment({
    required this.number,
    required this.amount,
    required this.dueDate,
    required this.description,
  });

  final int number;
  final double amount;
  final String dueDate;
  final String description;

  factory FeeInstalment.fromJson(Map<String, dynamic> json) {
    return FeeInstalment(
      number: (json['number'] as num?)?.toInt() ?? 0,
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
      dueDate: json['dueDate'] as String? ?? '',
      description: json['description'] as String? ?? '',
    );
  }
}

class FeePlanPreview {
  const FeePlanPreview({
    required this.instalments,
    required this.message,
    required this.problem,
  });

  final List<FeeInstalment> instalments;
  final String message;
  final bool problem;

  factory FeePlanPreview.fromJson(Map<String, dynamic> json) {
    return FeePlanPreview(
      instalments: (json['instalments'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FeeInstalment.fromJson)
          .toList(),
      message: json['message'] as String? ?? '',
      problem: json['problem'] as bool? ?? false,
    );
  }
}

class FeePlanCubit extends Cubit<FeePlanState> {
  FeePlanCubit({required this.api}) : super(const FeePlanState());

  final ApiClient api;

  Future<void> preview({
    required double totalRupees,
    required int count,
    required String firstDueDate,
    required String cadence,
    required String label,
  }) async {
    emit(state.copyWith(previewing: true, error: null, preview: null));
    try {
      final json = await api.post<Map<String, dynamic>>('/fees/plans/preview', {
        'totalRupees': totalRupees,
        'count': count,
        'firstDueDate': firstDueDate,
        'cadence': cadence,
        'label': label,
      });
      if (isClosed) return;
      emit(state.copyWith(
        previewing: false,
        preview: FeePlanPreview.fromJson(json),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(previewing: false, error: error));
    }
  }

  Future<void> create({
    required String studentId,
    required double totalRupees,
    required int count,
    required String firstDueDate,
    required String cadence,
    required String label,
  }) async {
    emit(state.copyWith(creating: true, error: null));
    try {
      await api.post('/fees/plans', {
        'studentId': studentId,
        'totalRupees': totalRupees,
        'count': count,
        'firstDueDate': firstDueDate,
        'cadence': cadence,
        'label': label,
      });
      if (isClosed) return;
      emit(state.copyWith(creating: false, created: true));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(creating: false, error: error));
    }
  }
}

class FeePlanState extends Equatable {
  const FeePlanState({
    this.previewing = false,
    this.creating = false,
    this.preview,
    this.error,
    this.created = false,
  });

  final bool previewing;
  final bool creating;
  final FeePlanPreview? preview;
  final ApiException? error;
  final bool created;

  FeePlanState copyWith({
    bool? previewing,
    bool? creating,
    FeePlanPreview? preview,
    ApiException? error,
    bool? created,
  }) {
    return FeePlanState(
      previewing: previewing ?? this.previewing,
      creating: creating ?? this.creating,
      preview: preview ?? this.preview,
      error: error,
      created: created ?? this.created,
    );
  }

  @override
  List<Object?> get props => [previewing, creating, preview, error, created];
}
