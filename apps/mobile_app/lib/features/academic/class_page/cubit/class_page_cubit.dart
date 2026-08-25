import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

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
  final String? error;
  final Duration? countdown;

  @override
  List<Object?> get props =>
      [status, joinRoute, checkedIn, error, countdown];

  ClassPageState copyWith({
    ClassPageStatus? status,
    JoinRoute? joinRoute,
    bool? checkedIn,
    String? error,
    Duration? countdown,
  }) {
    return ClassPageState(
      status: status ?? this.status,
      joinRoute: joinRoute ?? this.joinRoute,
      checkedIn: checkedIn ?? this.checkedIn,
      error: error ?? this.error,
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
    emit(state.copyWith(status: ClassPageStatus.loading));
    try {
      final joinRoute = await _repo.getJoinRoute(sessionId);
      emit(state.copyWith(
        status: ClassPageStatus.loaded,
        joinRoute: joinRoute,
      ));
      _startCountdownIfNeeded(joinRoute);
    } catch (e) {
      emit(state.copyWith(
        status: ClassPageStatus.failure,
        error: 'Failed to load class: $e',
      ));
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
      emit(state.copyWith(checkedIn: true));
    } catch (e) {
      emit(state.copyWith(error: 'Check-in failed: $e'));
    }
  }

  @override
  Future<void> close() {
    _countdownTimer?.cancel();
    return super.close();
  }
}
