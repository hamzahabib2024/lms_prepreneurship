import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/certificates_repository.dart';
import '../data/models/certificate_register.dart';

enum RegisterStatus { initial, loading, loaded, failure }

class RegisterState extends Equatable {
  const RegisterState({
    this.status = RegisterStatus.initial,
    this.summary,
    this.entries = const [],
    this.query = '',
    this.filterStatus,
    this.filterType,
    this.page = 1,
    this.totalPages = 1,
    this.totalItems = 0,
    this.hasNext = false,
    this.loadingMore = false,
    this.error,
  });

  final RegisterStatus status;
  final RegisterSummary? summary;
  final List<RegisterEntry> entries;

  final String query;

  /// ISSUED, REVOKED, ARCHIVED — or null for all of them.
  final String? filterStatus;

  /// SUBJECT or PROGRAMME — or null for both.
  final String? filterType;

  final int page;
  final int totalPages;
  final int totalItems;
  final bool hasNext;
  final bool loadingMore;
  final ApiException? error;

  @override
  List<Object?> get props => [
        status,
        summary,
        entries,
        query,
        filterStatus,
        filterType,
        page,
        totalPages,
        totalItems,
        hasNext,
        loadingMore,
        error,
      ];

  RegisterState copyWith({
    RegisterStatus? status,
    RegisterSummary? summary,
    List<RegisterEntry>? entries,
    String? query,
    String? filterStatus,
    String? filterType,
    int? page,
    int? totalPages,
    int? totalItems,
    bool? hasNext,
    bool? loadingMore,
    ApiException? error,
    bool clearError = false,
    bool clearStatusFilter = false,
    bool clearTypeFilter = false,
  }) {
    return RegisterState(
      status: status ?? this.status,
      summary: summary ?? this.summary,
      entries: entries ?? this.entries,
      query: query ?? this.query,
      filterStatus: clearStatusFilter ? null : (filterStatus ?? this.filterStatus),
      filterType: clearTypeFilter ? null : (filterType ?? this.filterType),
      page: page ?? this.page,
      totalPages: totalPages ?? this.totalPages,
      totalItems: totalItems ?? this.totalItems,
      hasNext: hasNext ?? this.hasNext,
      loadingMore: loadingMore ?? this.loadingMore,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class RegisterCubit extends Cubit<RegisterState> {
  RegisterCubit(this._repo) : super(const RegisterState());

  final CertificatesRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(status: RegisterStatus.loading, clearError: true));
    try {
      // Both at once: the figures at the head and the first page are one
      // screen, and fetching them in series makes the header arrive late.
      final results = await Future.wait([
        _repo.registerSummary(),
        _repo.register(
          query: state.query,
          status: state.filterStatus,
          type: state.filterType,
        ),
      ]);
      if (isClosed) return;
      final summary = results[0] as RegisterSummary;
      final page = results[1] as RegisterPage;
      emit(state.copyWith(
        status: RegisterStatus.loaded,
        summary: summary,
        entries: page.entries,
        page: page.page,
        totalPages: page.totalPages,
        totalItems: page.totalItems,
        hasNext: page.hasNext,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: RegisterStatus.failure, error: e));
    }
  }

  Future<void> search(String query) async {
    emit(state.copyWith(query: query, page: 1));
    await load();
  }

  Future<void> filterByStatus(String? status) async {
    emit(state.copyWith(
      filterStatus: status,
      clearStatusFilter: status == null,
      page: 1,
    ));
    await load();
  }

  Future<void> filterByType(String? type) async {
    emit(state.copyWith(
      filterType: type,
      clearTypeFilter: type == null,
      page: 1,
    ));
    await load();
  }

  /// Appends rather than replaces: a register is read by scrolling, and a
  /// page that swaps its contents loses the row somebody was looking at.
  Future<void> loadMore() async {
    if (!state.hasNext || state.loadingMore) return;
    emit(state.copyWith(loadingMore: true, clearError: true));
    try {
      final next = await _repo.register(
        query: state.query,
        status: state.filterStatus,
        type: state.filterType,
        page: state.page + 1,
      );
      if (isClosed) return;
      emit(state.copyWith(
        loadingMore: false,
        entries: [...state.entries, ...next.entries],
        page: next.page,
        hasNext: next.hasNext,
      ));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(loadingMore: false, error: e));
    }
  }

  /// FR-CRT — a revocation needs a reason, because the register is what an
  /// employer checks and "revoked, no reason given" answers nothing.
  Future<bool> revoke(String certificateId, String reason) async {
    emit(state.copyWith(clearError: true));
    try {
      await _repo.revoke(
        certificateId: certificateId,
        reason: reason,
      );
      if (isClosed) return false;
      await load();
      return true;
    } on ApiException catch (e) {
      if (isClosed) return false;
      emit(state.copyWith(error: e));
      return false;
    }
  }
}
