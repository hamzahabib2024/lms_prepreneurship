import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/certificates_repository.dart';
import '../data/models/batch_issue_result.dart';
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
    this.batchBusy,
    this.batchResult,
  });

  final IssuanceStatus status;
  final List<CertificateCandidate> students;
  final int eligible;
  final int issued;
  final ProgrammeStanding? standing;
  final ApiException? error;
  final String? busyStudentId;
  final String? successMessage;

  /// 'ready' or 'everyone' while a batch issue is in flight — the two buttons
  /// mean different things and only the pressed one should say so.
  final String? batchBusy;
  final BatchIssueResult? batchResult;

  IssuanceState copyWith({
    IssuanceStatus? status,
    List<CertificateCandidate>? students,
    int? eligible,
    int? issued,
    ProgrammeStanding? standing,
    ApiException? error,
    String? busyStudentId,
    String? successMessage,
    String? batchBusy,
    BatchIssueResult? batchResult,
    bool clearError = false,
    bool clearBusy = false,
    bool clearSuccess = false,
    bool clearBatchBusy = false,
    bool clearBatchResult = false,
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
        batchBusy: clearBatchBusy ? null : (batchBusy ?? this.batchBusy),
        batchResult:
            clearBatchResult ? null : (batchResult ?? this.batchResult),
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
        batchBusy,
        batchResult,
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

  /// FR-CRT — issue to everybody on the batch at once.
  ///
  /// Two acts, not one with a checkbox. [everyone] false issues to the
  /// students who qualify; [everyone] true is the office overruling the
  /// requirements, and each certificate then records that it was issued over
  /// them and by whom.
  ///
  /// [reason] is recorded, not demanded. A required field here would be the
  /// software insisting on an explanation from the people it works for, and
  /// what it would actually produce is the word "yes" in a box.
  Future<void> issueAll(
    String sectionSubjectId, {
    required bool everyone,
    String? reason,
  }) async {
    emit(state.copyWith(
      batchBusy: everyone ? 'everyone' : 'ready',
      clearError: true,
      clearBatchResult: true,
    ));
    try {
      final result = await repository.issueAll(
        sectionSubjectId: sectionSubjectId,
        everyone: everyone,
        reason: reason == null || reason.trim().isEmpty ? null : reason.trim(),
      );
      if (isClosed) return;
      emit(state.copyWith(clearBatchBusy: true, batchResult: result));
      // The eligibility counts and every row's state have moved.
      await load(sectionSubjectId);
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(clearBatchBusy: true, error: e));
    }
  }

  void dismissBatchResult() => emit(state.copyWith(clearBatchResult: true));
}
