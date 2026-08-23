import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/network/api_exception.dart';
import '../data/reporting_repository.dart';
import '../data/models/models.dart';

class ReportRunnerState extends Equatable {
  const ReportRunnerState({
    this.status = ReportRunnerStatus.idle,
    this.currentKey,
    this.result,
    this.error,
    this.exporting = false,
    this.exportPath,
  });

  final ReportRunnerStatus status;
  final String? currentKey;
  final ReportResult? result;
  final ApiException? error;
  final bool exporting;
  final String? exportPath;

  ReportRunnerState copyWith({
    ReportRunnerStatus? status,
    String? currentKey,
    ReportResult? result,
    ApiException? error,
    bool? exporting,
    String? exportPath,
    bool clearError = false,
    bool clearResult = false,
    bool clearExport = false,
  }) =>
      ReportRunnerState(
        status: status ?? this.status,
        currentKey: currentKey ?? this.currentKey,
        result: clearResult ? null : (result ?? this.result),
        error: clearError ? null : (error ?? this.error),
        exporting: exporting ?? this.exporting,
        exportPath: clearExport ? null : (exportPath ?? this.exportPath),
      );

  @override
  List<Object?> get props => [
        status,
        currentKey,
        result,
        error,
        exporting,
        exportPath,
      ];
}

enum ReportRunnerStatus { idle, running, success, failure }

class ReportRunnerCubit extends Cubit<ReportRunnerState> {
  ReportRunnerCubit({required this.repository})
      : super(const ReportRunnerState());

  final ReportingRepository repository;

  Future<void> run(String key, {Map<String, String>? filters}) async {
    emit(state.copyWith(
      status: ReportRunnerStatus.running,
      currentKey: key,
      clearError: true,
      clearResult: true,
    ));
    try {
      final result = await repository.run(key, filters: filters);
      emit(state.copyWith(
        status: ReportRunnerStatus.success,
        result: result,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: ReportRunnerStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> exportCsv(String key, {Map<String, String>? filters}) async {
    emit(state.copyWith(exporting: true, clearError: true, clearExport: true));
    try {
      final bytes = await repository.export(key, filters: filters);
      final dir = await getApplicationDocumentsDirectory();
      final now = DateTime.now();
      final filename =
          '${key}_${now.year}${_pad(now.month)}${_pad(now.day)}_${_pad(now.hour)}${_pad(now.minute)}.csv';
      final file = File('${dir.path}/$filename');
      await file.writeAsBytes(bytes);
      emit(state.copyWith(
        exporting: false,
        exportPath: file.path,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(exporting: false, error: e));
    }
  }

  void clear() {
    emit(const ReportRunnerState());
  }

  String _pad(int n) => n.toString().padLeft(2, '0');
}
