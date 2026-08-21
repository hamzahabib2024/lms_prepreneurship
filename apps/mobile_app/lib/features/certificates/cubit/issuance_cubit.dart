import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/certificates_repository.dart';
import '../data/models/certificate_candidate.dart';
import '../data/models/programme_standing.dart';

/// State for the admin certificate issuance worklist.
class IssuanceState extends Equatable {
  const IssuanceState({
    this.status = IssuanceStatus.loading,
    this.students = const [],
    this.eligible = 0,
    this.issued = 0,
    this.standing,
    this.error,
    this.busyStudentId,
    this.successMessage,
  });

  final IssuanceStatus status;
  final List<CertificateCandidate> students;
  final int eligible;
  final int issued;
  final ProgrammeStanding? standing;
  final ApiException? error;
  final String? busyStudentId;
  final String? successMessage;

  IssuanceState copyWith({
    IssuanceStatus? status,
    List<CertificateCandidate>? students,
    int? eligible,
    int? issued,
    ProgrammeStanding? standing,
    ApiException? error,
    String? busyStudentId,
    String? successMessage,
    bool clearError = false,
    bool clearBusy = false,
    bool clearSuccess = false,
  }) =>
      IssuanceState(
        status: status ?? this.status,
        students: students ?? this.students,
        eligible: eligible ?? this.eligible,
        issued: issued ?? this.issued,
        standing: standing ?? this.standing,
        error: clearError ? null : (error ?? this.error),
        busyStudentId: clearBusy ? null : (busyStudentId ?? this.busyStudentId),
        successMessage:
            clearSuccess ? null : (successMessage ?? this.successMessage),
      );

  @override
  List<Object?> get props => [
        status,
        students,
        eligible,
        issued,
        standing,
        error,
        busyStudentId,
        successMessage,
      ];
}

enum IssuanceStatus { loading, loaded, failure }

/// Cubit for the admin certificate issuance page.
class IssuanceCubit extends Cubit<IssuanceState> {
  IssuanceCubit({required this.repository}) : super(const IssuanceState());

  final CertificatesRepository repository;
  String _sectionSubjectId = '';

  /// Load the issuance worklist for a section-subject.
  Future<void> load(String sectionSubjectId) async {
    _sectionSubjectId = sectionSubjectId;
    emit(state.copyWith(
      status: IssuanceStatus.loading,
      clearError: true,
      clearSuccess: true,
    ));
    try {
      final view = await repository.issuanceView(sectionSubjectId);
      if (!isClosed) {
        emit(state.copyWith(
          status: IssuanceStatus.loaded,
          students: view.students,
          eligible: view.eligible,
          issued: view.issued,
        ));
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(
          status: IssuanceStatus.failure,
          error: e,
        ));
      }
    }
  }

  /// Issue a subject certificate to a student.
  Future<void> issueSubject(String studentId) async {
    emit(state.copyWith(busyStudentId: studentId, clearError: true));
    try {
      await repository.issueSubject(
        studentId: studentId,
        sectionSubjectId: _sectionSubjectId,
      );
      if (!isClosed) {
        emit(state.copyWith(
          clearBusy: true,
          successMessage: 'Certificate issued successfully.',
        ));
        // Reload the worklist to reflect the new state.
        await load(_sectionSubjectId);
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(clearBusy: true, error: e));
      }
    }
  }

  /// Revoke a certificate.
  Future<void> revoke({
    required String certificateId,
    required String reason,
  }) async {
    emit(state.copyWith(clearError: true, clearSuccess: true));
    try {
      await repository.revoke(
        certificateId: certificateId,
        reason: reason,
      );
      if (!isClosed) {
        emit(state.copyWith(
          successMessage: 'Certificate revoked.',
        ));
        await load(_sectionSubjectId);
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(error: e));
      }
    }
  }

  /// Check programme certificate standing.
  Future<void> checkProgrammeStanding({
    required String studentId,
    required String programmeId,
  }) async {
    emit(state.copyWith(clearError: true));
    try {
      final standing = await repository.programmeStanding(
        studentId: studentId,
        programmeId: programmeId,
      );
      if (!isClosed) {
        emit(state.copyWith(standing: standing));
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(error: e));
      }
    }
  }

  /// Issue a programme certificate.
  Future<void> issueProgramme({
    required String studentId,
    required String programmeId,
  }) async {
    emit(state.copyWith(busyStudentId: studentId, clearError: true));
    try {
      await repository.issueProgramme(
        studentId: studentId,
        programmeId: programmeId,
      );
      if (!isClosed) {
        emit(state.copyWith(
          clearBusy: true,
          successMessage: 'Programme certificate issued.',
        ));
      }
    } on ApiException catch (e) {
      if (!isClosed) {
        emit(state.copyWith(clearBusy: true, error: e));
      }
    }
  }
}
