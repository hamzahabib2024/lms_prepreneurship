import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/certificates_repository.dart';

/// State for the public certificate verification page.
class VerifyState extends Equatable {
  const VerifyState({
    this.status = VerifyStatus.initial,
    this.result,
    this.error,
  });

  final VerifyStatus status;
  final VerifyResult? result;
  final ApiException? error;

  VerifyState copyWith({
    VerifyStatus? status,
    VerifyResult? result,
    ApiException? error,
    bool clearError = false,
  }) =>
      VerifyState(
        status: status ?? this.status,
        result: result ?? this.result,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, result, error];
}

enum VerifyStatus { initial, loading, found, notFound, failure }

/// Cubit for public certificate verification.
class VerifyCubit extends Cubit<VerifyState> {
  VerifyCubit({required this.repository}) : super(const VerifyState());

  final CertificatesRepository repository;

  Future<void> verify(String code) async {
    if (code.trim().isEmpty) return;
    emit(state.copyWith(
      status: VerifyStatus.loading,
      clearError: true,
    ));
    try {
      final result = await repository.verify(code.trim());
      if (!isClosed) {
        emit(state.copyWith(
          status: result.found ? VerifyStatus.found : VerifyStatus.notFound,
          result: result,
        ));
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(
          status: VerifyStatus.failure,
          error: e,
        ));
      }
    }
  }
}
