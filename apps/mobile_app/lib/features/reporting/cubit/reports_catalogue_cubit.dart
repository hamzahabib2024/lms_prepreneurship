import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/reporting_repository.dart';
import '../data/models/models.dart';

class ReportsCatalogueState extends Equatable {
  const ReportsCatalogueState({
    this.status = ReportsCatalogueStatus.loading,
    this.reports = const [],
    this.sections = const [],
    this.error,
  });

  final ReportsCatalogueStatus status;
  final List<ReportDefinition> reports;
  final List<ReportSection> sections;
  final ApiException? error;

  ReportsCatalogueState copyWith({
    ReportsCatalogueStatus? status,
    List<ReportDefinition>? reports,
    List<ReportSection>? sections,
    ApiException? error,
    bool clearError = false,
  }) =>
      ReportsCatalogueState(
        status: status ?? this.status,
        reports: reports ?? this.reports,
        sections: sections ?? this.sections,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, reports, sections, error];
}

enum ReportsCatalogueStatus { loading, loaded, failure }

class ReportsCatalogueCubit extends Cubit<ReportsCatalogueState> {
  ReportsCatalogueCubit({required this.repository})
      : super(const ReportsCatalogueState());

  final ReportingRepository repository;

  Future<void> load() async {
    emit(state.copyWith(
      status: ReportsCatalogueStatus.loading,
      clearError: true,
    ));
    try {
      final results = await Future.wait([
        repository.catalogue(),
        repository.sections(),
      ]);
      emit(state.copyWith(
        status: ReportsCatalogueStatus.loaded,
        reports: results[0] as List<ReportDefinition>,
        sections: results[1] as List<ReportSection>,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: ReportsCatalogueStatus.failure,
        error: e,
      ));
    }
  }
}
