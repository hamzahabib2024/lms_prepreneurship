import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/certificates_repository.dart';
import '../data/models/certificate.dart';

/// State for the student's certificate list.
class MyCertificatesState extends Equatable {
  const MyCertificatesState({
    this.status = MyCertificatesStatus.loading,
    this.certificates = const [],
    this.error,
  });

  final MyCertificatesStatus status;
  final List<Certificate> certificates;
  final ApiException? error;

  int get issuedCount =>
      certificates.where((c) => c.isIssued).length;

  MyCertificatesState copyWith({
    MyCertificatesStatus? status,
    List<Certificate>? certificates,
    ApiException? error,
    bool clearError = false,
  }) =>
      MyCertificatesState(
        status: status ?? this.status,
        certificates: certificates ?? this.certificates,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, certificates, error];
}

enum MyCertificatesStatus { loading, loaded, failure }

/// Cubit for the student's own certificate list.
class MyCertificatesCubit extends Cubit<MyCertificatesState> {
  MyCertificatesCubit({required this.repository})
      : super(const MyCertificatesState());

  final CertificatesRepository repository;

  Future<void> load() async {
    emit(state.copyWith(
      status: MyCertificatesStatus.loading,
      clearError: true,
    ));
    try {
      final certificates = await repository.myCertificates();
      if (!isClosed) {
        emit(state.copyWith(
          status: MyCertificatesStatus.loaded,
          certificates: certificates,
        ));
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(
          status: MyCertificatesStatus.failure,
          error: e,
        ));
      }
    }
  }
}
