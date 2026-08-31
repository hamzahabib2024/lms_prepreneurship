import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/fees_repository.dart';
import '../data/models/fees_models.dart';

// ── Student Fees Cubit ──

class StudentFeesState extends Equatable {
  const StudentFeesState({
    this.status = StudentFeesStatus.initial,
    this.summary,
    this.bankDetails,
    this.submissions = const [],
    this.error,
  });

  final StudentFeesStatus status;
  final FeeSummary? summary;
  final BankDetails? bankDetails;
  final List<PaymentSubmission> submissions;
  final String? error;

  @override
  List<Object?> get props =>
      [status, summary, bankDetails, submissions, error];

  StudentFeesState copyWith({
    StudentFeesStatus? status,
    FeeSummary? summary,
    BankDetails? bankDetails,
    List<PaymentSubmission>? submissions,
    String? error,
  }) {
    return StudentFeesState(
      status: status ?? this.status,
      summary: summary ?? this.summary,
      bankDetails: bankDetails ?? this.bankDetails,
      submissions: submissions ?? this.submissions,
      error: error ?? this.error,
    );
  }
}

enum StudentFeesStatus { initial, loading, loaded, failure }

class StudentFeesCubit extends Cubit<StudentFeesState> {
  StudentFeesCubit(this._repo) : super(const StudentFeesState());
  final FeesRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(status: StudentFeesStatus.loading));
    try {
      final results = await Future.wait([
        _repo.getMyFeeSummary(),
        _repo.getMySubmissions(),
      ]);
      final summary = results[0] as FeeSummary;
      final submissions = results[1] as List<PaymentSubmission>;
      emit(state.copyWith(
        status: StudentFeesStatus.loaded,
        summary: summary,
        submissions: submissions,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: StudentFeesStatus.failure,
        error: 'Failed to load fees: $e',
      ));
    }
  }

  Future<void> withdrawSubmission(String submissionId) async {
    try {
      await _repo.withdrawSubmission(submissionId);
      await load();
    } catch (e) {
      emit(state.copyWith(error: 'Failed to withdraw: $e'));
    }
  }
}

// ── Payment Submit Cubit ──

class PaymentSubmitState extends Equatable {
  const PaymentSubmitState({
    this.status = PaymentSubmitStatus.initial,
    this.bankDetails,
    this.feeSummary,
    this.amount = 0,
    this.method = 'BANK_TRANSFER',
    this.paidOn = '',
    this.bankReference = '',
    this.studentNote = '',
    this.submitting,
    this.error,
  });

  final PaymentSubmitStatus status;
  final BankDetails? bankDetails;
  final FeeSummary? feeSummary;
  final num amount;
  final String method;
  final String paidOn;
  final String bankReference;
  final String studentNote;
  final bool? submitting;
  final String? error;

  @override
  List<Object?> get props => [
    status, bankDetails, feeSummary, amount, method, paidOn,
    bankReference, studentNote, submitting, error,
  ];

  PaymentSubmitState copyWith({
    PaymentSubmitStatus? status,
    BankDetails? bankDetails,
    FeeSummary? feeSummary,
    num? amount,
    String? method,
    String? paidOn,
    String? bankReference,
    String? studentNote,
    bool? submitting,
    String? error,
  }) {
    return PaymentSubmitState(
      status: status ?? this.status,
      bankDetails: bankDetails ?? this.bankDetails,
      feeSummary: feeSummary ?? this.feeSummary,
      amount: amount ?? this.amount,
      method: method ?? this.method,
      paidOn: paidOn ?? this.paidOn,
      bankReference: bankReference ?? this.bankReference,
      studentNote: studentNote ?? this.studentNote,
      submitting: submitting ?? this.submitting,
      error: error ?? this.error,
    );
  }
}

enum PaymentSubmitStatus { initial, loading, loaded, submitting, submitted, failure }

class PaymentSubmitCubit extends Cubit<PaymentSubmitState> {
  PaymentSubmitCubit(this._repo) : super(const PaymentSubmitState());
  final FeesRepository _repo;

  Future<void> loadBankDetails() async {
    emit(state.copyWith(status: PaymentSubmitStatus.loading));
    try {
      final bankDetails = await _repo.getBankDetails();
      emit(state.copyWith(
        status: PaymentSubmitStatus.loaded,
        bankDetails: bankDetails,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: PaymentSubmitStatus.failure,
        error: 'Failed to load bank details: $e',
      ));
    }
  }

  Future<void> loadFeeSummary() async {
    try {
      final summary = await _repo.getMyFeeSummary();
      emit(state.copyWith(feeSummary: summary));
    } catch (e) {
      // Fee summary is non-critical — don't block the form.
    }
  }

  void updateAmount(num value) => emit(state.copyWith(amount: value));
  void updateMethod(String value) => emit(state.copyWith(method: value));
  void updatePaidOn(String value) => emit(state.copyWith(paidOn: value));
  void updateBankReference(String value) => emit(state.copyWith(bankReference: value));
  void updateStudentNote(String value) => emit(state.copyWith(studentNote: value));

  Future<void> submit() async {
    if (state.amount <= 0) {
      emit(state.copyWith(error: 'Enter a valid amount'));
      return;
    }
    if (state.paidOn.isEmpty) {
      emit(state.copyWith(error: 'Select payment date'));
      return;
    }

    emit(state.copyWith(submitting: true, error: null));
    try {
      await _repo.submitPayment(
        amount: state.amount,
        method: state.method,
        paidOn: state.paidOn,
        bankReference: state.bankReference.isNotEmpty ? state.bankReference : null,
        studentNote: state.studentNote.isNotEmpty ? state.studentNote : null,
      );
      emit(state.copyWith(status: PaymentSubmitStatus.submitted, submitting: false));
    } catch (e) {
      emit(state.copyWith(submitting: false, error: 'Failed to submit: $e'));
    }
  }
}

// ── Verification Queue Cubit ──

class VerificationQueueState extends Equatable {
  const VerificationQueueState({
    this.status = VerificationQueueStatus.initial,
    this.stats,
    this.rows = const [],
    this.filterStatus = '',
    this.filterQuery = '',
    this.error,
  });

  final VerificationQueueStatus status;
  final VerificationStats? stats;
  final List<VerificationQueueRow> rows;
  final String filterStatus;
  final String filterQuery;
  final String? error;

  @override
  List<Object?> get props =>
      [status, stats, rows, filterStatus, filterQuery, error];

  VerificationQueueState copyWith({
    VerificationQueueStatus? status,
    VerificationStats? stats,
    List<VerificationQueueRow>? rows,
    String? filterStatus,
    String? filterQuery,
    String? error,
  }) {
    return VerificationQueueState(
      status: status ?? this.status,
      stats: stats ?? this.stats,
      rows: rows ?? this.rows,
      filterStatus: filterStatus ?? this.filterStatus,
      filterQuery: filterQuery ?? this.filterQuery,
      error: error ?? this.error,
    );
  }
}

enum VerificationQueueStatus { initial, loading, loaded, failure }

class VerificationQueueCubit extends Cubit<VerificationQueueState> {
  VerificationQueueCubit(this._repo) : super(const VerificationQueueState());
  final FeesRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(status: VerificationQueueStatus.loading));
    try {
      final results = await Future.wait([
        _repo.getVerificationStats(),
        _repo.getVerificationQueue(
          status: state.filterStatus.isNotEmpty ? state.filterStatus : null,
          query: state.filterQuery.isNotEmpty ? state.filterQuery : null,
        ),
      ]);
      emit(state.copyWith(
        status: VerificationQueueStatus.loaded,
        stats: results[0] as VerificationStats,
        rows: results[1] as List<VerificationQueueRow>,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: VerificationQueueStatus.failure,
        error: 'Failed to load queue: $e',
      ));
    }
  }

  void updateFilterStatus(String value) {
    emit(state.copyWith(filterStatus: value));
    load();
  }

  void updateFilterQuery(String value) {
    emit(state.copyWith(filterQuery: value));
    load();
  }

  Future<void> verify({
    required String submissionId,
    required num verifiedAmount,
    String? note,
  }) async {
    try {
      await _repo.verifySubmission(
        submissionId: submissionId,
        verifiedAmount: verifiedAmount,
        note: note,
      );
      await load();
    } catch (e) {
      emit(state.copyWith(error: 'Failed to verify: $e'));
    }
  }

  Future<void> reject({
    required String submissionId,
    required String reason,
  }) async {
    try {
      await _repo.rejectSubmission(
        submissionId: submissionId,
        reason: reason,
      );
      await load();
    } catch (e) {
      emit(state.copyWith(error: 'Failed to reject: $e'));
    }
  }
}

// ── Receipt Cubit ──

class FeesState extends Equatable {
  const FeesState({
    this.loadingReceipt = false,
    this.receipt,
  });

  final bool loadingReceipt;
  final Receipt? receipt;

  @override
  List<Object?> get props => [loadingReceipt, receipt];

  FeesState copyWith({
    bool? loadingReceipt,
    Receipt? receipt,
  }) {
    return FeesState(
      loadingReceipt: loadingReceipt ?? this.loadingReceipt,
      receipt: receipt ?? this.receipt,
    );
  }
}

class FeesCubit extends Cubit<FeesState> {
  FeesCubit({required this.repository}) : super(const FeesState());
  final FeesRepository repository;

  Future<void> loadReceipt(String paymentId) async {
    emit(state.copyWith(loadingReceipt: true));
    try {
      final receipt = await repository.getReceipt(paymentId);
      emit(state.copyWith(loadingReceipt: false, receipt: receipt));
    } catch (e) {
      emit(state.copyWith(loadingReceipt: false));
    }
  }
}

// ── Staff Fees Cubit (Debtor List) ──

class StaffFeesState extends Equatable {
  const StaffFeesState({
    this.status = StaffFeesStatus.initial,
    this.debtors = const [],
    this.error,
  });

  final StaffFeesStatus status;
  final List<DebtorRow> debtors;
  final String? error;

  @override
  List<Object?> get props => [status, debtors, error];

  StaffFeesState copyWith({
    StaffFeesStatus? status,
    List<DebtorRow>? debtors,
    String? error,
  }) {
    return StaffFeesState(
      status: status ?? this.status,
      debtors: debtors ?? this.debtors,
      error: error,
    );
  }
}

enum StaffFeesStatus { initial, loading, loaded, failure }

class StaffFeesCubit extends Cubit<StaffFeesState> {
  StaffFeesCubit(this._repo) : super(const StaffFeesState());
  final FeesRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(status: StaffFeesStatus.loading));
    try {
      final debtors = await _repo.getDebtors();
      emit(state.copyWith(
        status: StaffFeesStatus.loaded,
        debtors: debtors,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: StaffFeesStatus.failure,
        error: 'Failed to load debtors: $e',
      ));
    }
  }
}

// ── Staff Statement Cubit (Student Statement View) ──

class StaffStatementState extends Equatable {
  const StaffStatementState({
    this.status = StaffStatementStatus.initial,
    this.statement,
    this.busy = false,
    this.planPreview,
    this.planLoading = false,
    this.error,
  });

  final StaffStatementStatus status;
  final StudentStatement? statement;
  final bool busy;
  final InstalmentPlanPreview? planPreview;
  final bool planLoading;
  final String? error;

  @override
  List<Object?> get props => [status, statement, busy, planPreview, planLoading, error];

  StaffStatementState copyWith({
    StaffStatementStatus? status,
    StudentStatement? statement,
    bool? busy,
    InstalmentPlanPreview? planPreview,
    bool? planLoading,
    String? error,
  }) {
    return StaffStatementState(
      status: status ?? this.status,
      statement: statement ?? this.statement,
      busy: busy ?? this.busy,
      planPreview: planPreview,
      planLoading: planLoading ?? this.planLoading,
      error: error,
    );
  }
}

enum StaffStatementStatus { initial, loading, loaded, failure }

class StaffStatementCubit extends Cubit<StaffStatementState> {
  StaffStatementCubit(this._repo) : super(const StaffStatementState());
  final FeesRepository _repo;
  String? _studentId;

  Future<void> load(String studentId) async {
    _studentId = studentId;
    emit(state.copyWith(status: StaffStatementStatus.loading));
    try {
      final statement = await _repo.getStudentStatement(studentId);
      emit(state.copyWith(
        status: StaffStatementStatus.loaded,
        statement: statement,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: StaffStatementStatus.failure,
        error: 'Failed to load statement: $e',
      ));
    }
  }

  Future<void> addCharge({
    required String description,
    required num amount,
    required String dueDate,
  }) async {
    if (_studentId == null) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      await _repo.addCharge(
        studentId: _studentId!,
        description: description,
        amount: amount,
        dueDate: dueDate,
      );
      await load(_studentId!);
    } catch (e) {
      emit(state.copyWith(busy: false, error: 'Failed to add charge: $e'));
    }
  }

  Future<void> waiveCharge({
    required String chargeId,
    required String reason,
  }) async {
    if (_studentId == null) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      await _repo.waiveCharge(chargeId: chargeId, reason: reason);
      await load(_studentId!);
    } catch (e) {
      emit(state.copyWith(busy: false, error: 'Failed to waive charge: $e'));
    }
  }

  Future<void> recordPayment({
    required num amount,
    required String paymentDate,
    required String method,
    String? bankReference,
  }) async {
    if (_studentId == null) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      await _repo.recordPayment(
        studentId: _studentId!,
        amount: amount,
        paymentDate: paymentDate,
        method: method,
        bankReference: bankReference,
      );
      await load(_studentId!);
    } catch (e) {
      emit(state.copyWith(busy: false, error: 'Failed to record payment: $e'));
    }
  }

  Future<void> reversePayment({
    required String paymentId,
    required String reason,
  }) async {
    if (_studentId == null) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      await _repo.reversePayment(paymentId: paymentId, reason: reason);
      await load(_studentId!);
    } catch (e) {
      emit(state.copyWith(busy: false, error: 'Failed to reverse payment: $e'));
    }
  }

  Future<void> previewPlan({
    required num totalRupees,
    required int count,
    required String firstDueDate,
    required String cadence,
    required String label,
  }) async {
    emit(state.copyWith(planLoading: true, error: null));
    try {
      final result = await _repo.previewInstalmentPlan(
        totalRupees: totalRupees,
        count: count,
        firstDueDate: firstDueDate,
        cadence: cadence,
        label: label,
      );
      final preview = InstalmentPlanPreview.fromJson(result);
      emit(state.copyWith(planLoading: false, planPreview: preview));
    } catch (e) {
      emit(state.copyWith(planLoading: false, error: 'Could not work out the schedule: $e'));
    }
  }

  Future<void> createPlan({
    required num totalRupees,
    required int count,
    required String firstDueDate,
    required String cadence,
    required String label,
  }) async {
    if (_studentId == null) return;
    emit(state.copyWith(busy: true, error: null));
    try {
      await _repo.createInstalmentPlan(
        studentId: _studentId!,
        totalRupees: totalRupees,
        count: count,
        firstDueDate: firstDueDate,
        cadence: cadence,
        label: label,
      );
      emit(state.copyWith(planPreview: null));
      await load(_studentId!);
    } catch (e) {
      emit(state.copyWith(busy: false, error: 'Failed to create plan: $e'));
    }
  }
}
