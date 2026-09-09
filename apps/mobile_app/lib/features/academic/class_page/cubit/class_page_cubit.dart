import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/class_page_repository.dart';
import '../data/models/class_page_models.dart';

class ClassPageState extends Equatable {
  const ClassPageState({
    this.status = ClassPageStatus.initial,
    this.joinRoute,
    this.checkedIn = false,
    this.error,
    this.countdown,
  });

  final ClassPageStatus status;
  final JoinRoute? joinRoute;
  final bool checkedIn;
  final ApiException? error;
  final Duration? countdown;

  @override
  List<Object?> get props =>
      [status, joinRoute, checkedIn, error, countdown];

  ClassPageState copyWith({
    ClassPageStatus? status,
    JoinRoute? joinRoute,
    bool? checkedIn,
    ApiException? error,
    Duration? countdown,
    bool clearError = false,
  }) {
    return ClassPageState(
      status: status ?? this.status,
      joinRoute: joinRoute ?? this.joinRoute,
      checkedIn: checkedIn ?? this.checkedIn,
      error: clearError ? null : (error ?? this.error),
      countdown: countdown ?? this.countdown,
    );
  }
}

enum ClassPageStatus { initial, loading, loaded, failure }

class ClassPageCubit extends Cubit<ClassPageState> {
  ClassPageCubit(this._repo) : super(const ClassPageState());
  final ClassPageRepository _repo;
  Timer? _countdownTimer;

  Future<void> loadJoinRoute(String sessionId) async {
    emit(state.copyWith(status: ClassPageStatus.loading, clearError: true));
    try {
      final joinRoute = await _repo.getJoinRoute(sessionId);
      if (isClosed) return;
      emit(state.copyWith(
        status: ClassPageStatus.loaded,
        joinRoute: joinRoute,
      ));
      _startCountdownIfNeeded(joinRoute);
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(status: ClassPageStatus.failure, error: e));
    }
  }

  void _startCountdownIfNeeded(JoinRoute joinRoute) {
    _countdownTimer?.cancel();
    if (!joinRoute.isUnavailable) return;

    final retryAfter = joinRoute.retryAfter;
    if (retryAfter == null || retryAfter.isEmpty) return;

    final retryTime = DateTime.tryParse(retryAfter);
    if (retryTime == null) return;

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final remaining = retryTime.difference(DateTime.now());
      if (remaining.isNegative) {
        _countdownTimer?.cancel();
        emit(state.copyWith(countdown: Duration.zero));
        // Reload join route
        final sessionId = joinRoute.session.id;
        if (sessionId.isNotEmpty) loadJoinRoute(sessionId);
      } else {
        emit(state.copyWith(countdown: remaining));
      }
    });

    // Initial tick
    final remaining = retryTime.difference(DateTime.now());
    emit(state.copyWith(countdown: remaining.isNegative ? Duration.zero : remaining));
  }

  Future<void> checkIn(String sessionId) async {
    try {
      await _repo.checkIn(sessionId);
      if (isClosed) return;
      emit(state.copyWith(checkedIn: true));
    } on ApiException catch (e) {
      if (isClosed) return;
      emit(state.copyWith(error: e));
    }
  }

  @override
  Future<void> close() {
    _countdownTimer?.cancel();
    return super.close();
  }
}
