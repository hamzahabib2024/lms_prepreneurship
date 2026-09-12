import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/models/question_bank_models.dart';
import '../data/question_bank_repository.dart';

enum QuestionBankStatus { initial, loading, loaded, failure }

class QuestionBankState extends Equatable {
  const QuestionBankState({
    this.status = QuestionBankStatus.initial,
    this.banks = const [],
    this.selectedBankId,
    this.questions = const [],
    this.loadingQuestions = false,
    this.saving = false,
    this.includeRetired = false,
    this.error,
    this.problems = const [],
  });

  final QuestionBankStatus status;
  final List<QuestionBank> banks;
  final String? selectedBankId;
  final List<BankQuestion> questions;
  final bool loadingQuestions;
  final bool saving;
  final bool includeRetired;
  final ApiException? error;

  /// Every complaint the server made about a question, as separate lines.
  /// A teacher fixing one at a time gives up (NFR-ERR-005).
  final List<String> problems;

  QuestionBank? get selectedBank => selectedBankId == null
      ? null
      : banks.where((b) => b.id == selectedBankId).firstOrNull;

  @override
  List<Object?> get props => [
        status,
        banks,
        selectedBankId,
        questions,
        loadingQuestions,
        saving,
        includeRetired,
        error,
        problems,
      ];

  QuestionBankState copyWith({
    QuestionBankStatus? status,
    List<QuestionBank>? banks,
    String? selectedBankId,
    List<BankQuestion>? questions,
    bool? loadingQuestions,
    bool? saving,
    bool? includeRetired,
    ApiException? error,
    List<String>? problems,
    bool clearError = false,
  }) {
    return QuestionBankState(
      status: status ?? this.status,
      banks: banks ?? this.banks,
      selectedBankId: selectedBankId ?? this.selectedBankId,
      questions: questions ?? this.questions,
      loadingQuestions: loadingQuestions ?? this.loadingQuestions,
      saving: saving ?? this.saving,
      includeRetired: includeRetired ?? this.includeRetired,
      error: clearError ? null : (error ?? this.error),
      problems: problems ?? this.problems,
    );
  }
}

class QuestionBankCubit extends Cubit<QuestionBankState> {
  QuestionBankCubit(this._repo, {this.subjectId})
      : super(const QuestionBankState());

  final QuestionBankRepository _repo;

  /// When set, only this subject's banks are offered — the quiz builder knows
  /// which subject it is writing for, so it should not make a teacher scroll
  /// past every other subject's banks.
  final String? subjectId;

  Future<void> loadBanks() async {
    emit(state.copyWith(status: QuestionBankStatus.loading, clearError: true));
    try {
      final banks = await _repo.banks(subjectId: subjectId);
      if (isClosed) return;
      emit(state.copyWith(status: QuestionBankStatus.loaded, banks: banks));
      // One bank and nothing chosen is not a choice; open it.
      if (banks.length == 1 && state.selectedBankId == null) {
        await selectBank(banks.first.id);
      }
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: QuestionBankStatus.failure, error: e));
    }
  }

  Future<void> selectBank(String bankId) async {
    emit(state.copyWith(
      selectedBankId: bankId,
      questions: const [],
      loadingQuestions: true,
      clearError: true,
      problems: const [],
    ));
    await _loadQuestions();
  }

  Future<void> toggleRetired() async {
    emit(state.copyWith(
      includeRetired: !state.includeRetired,
      loadingQuestions: true,
    ));
    await _loadQuestions();
  }

  Future<void> _loadQuestions() async {
    final bankId = state.selectedBankId;
    if (bankId == null) return;
    try {
      final questions = await _repo.questions(
        bankId,
        includeRetired: state.includeRetired,
      );
      if (isClosed) return;
      emit(state.copyWith(questions: questions, loadingQuestions: false));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(loadingQuestions: false, error: e));
    }
  }

  Future<bool> createBank(String name) async {
    emit(state.copyWith(saving: true, clearError: true));
    try {
      final bank = await _repo.createBank(name: name, subjectId: subjectId);
      if (isClosed) return false;
      emit(state.copyWith(saving: false, banks: [...state.banks, bank]));
      await selectBank(bank.id);
      return true;
    } on ApiException catch (e) {
      if (isClosed) return false;
      emit(state.copyWith(saving: false, error: e));
      return false;
    }
  }

  /// True when the question was accepted. On a rejection the server's
  /// complaints are in [QuestionBankState.problems] — all of them, so the
  /// teacher fixes the question once rather than in several rounds.
  Future<bool> addQuestion(QuestionDraft draft) async {
    final bankId = state.selectedBankId;
    if (bankId == null) return false;
    emit(state.copyWith(saving: true, problems: const [], clearError: true));
    try {
      await _repo.addQuestion(bankId, draft);
      if (isClosed) return false;
      emit(state.copyWith(saving: false));
      await _loadQuestions();
      await _refreshCounts();
      return true;
    } on ApiException catch (e) {
      if (isClosed) return false;
      final lines = e.details
          .map((d) => (d['message'] as String? ?? '').trim())
          .where((line) => line.isNotEmpty)
          .toList();
      emit(state.copyWith(
        saving: false,
        problems: lines.isEmpty ? [e.message] : lines,
      ));
      return false;
    }
  }

  Future<void> retire(String questionId) async {
    emit(state.copyWith(clearError: true));
    try {
      await _repo.retire(questionId);
      if (isClosed) return;
      await _loadQuestions();
      await _refreshCounts();
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(error: e));
    }
  }

  /// The question count on each bank row is now wrong. Re-reading the list is
  /// cheaper than tracking the arithmetic, and it cannot drift.
  Future<void> _refreshCounts() async {
    try {
      final banks = await _repo.banks(subjectId: subjectId);
      if (isClosed) return;
      emit(state.copyWith(banks: banks));
    } on ApiException {
      // The counts being stale is not worth an error bar over.
    }
  }
}
