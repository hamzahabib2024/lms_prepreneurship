import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/courses_repository.dart';
import '../data/models/playback_ticket.dart';

/// How often played intervals are flushed to the server.
const _reportInterval = Duration(seconds: 15);

/// Ignore jumps larger than this — it is a seek, not viewing.
const _maxContiguousJump = 3;

/// State for the watch page / video player.
class WatchState extends Equatable {
  const WatchState({
    this.status = WatchStatus.loading,
    this.ticket,
    this.error,
    this.watchedPercent = 0,
    this.resumeApplied = false,
    this.recordsProgress = true,
  });

  final WatchStatus status;
  final PlaybackTicket? ticket;
  final ApiException? error;
  final double watchedPercent;
  final bool resumeApplied;
  final bool recordsProgress;

  WatchState copyWith({
    WatchStatus? status,
    PlaybackTicket? ticket,
    ApiException? error,
    double? watchedPercent,
    bool? resumeApplied,
    bool? recordsProgress,
    bool clearError = false,
  }) =>
      WatchState(
        status: status ?? this.status,
        ticket: ticket ?? this.ticket,
        error: clearError ? null : (error ?? this.error),
        watchedPercent: watchedPercent ?? this.watchedPercent,
        resumeApplied: resumeApplied ?? this.resumeApplied,
        recordsProgress: recordsProgress ?? this.recordsProgress,
      );

  @override
  List<Object?> get props =>
      [status, ticket, error, watchedPercent, resumeApplied, recordsProgress];
}

enum WatchStatus { loading, loaded, failure }

/// Cubit that manages video playback ticket, interval tracking, and
/// progress reporting — the mobile equivalent of LecturePlayer.tsx.
class WatchCubit extends Cubit<WatchState> {
  WatchCubit({
    required this.repository,
    required this.lectureId,
  }) : super(const WatchState());

  final CoursesRepository repository;
  final String lectureId;

  Timer? _reportTimer;
  final List<List<int>> _pendingIntervals = [];
  int _openStart = -1;
  int _lastPosition = 0;

  /// Fetch a playback ticket from the server.
  Future<void> loadTicket() async {
    emit(state.copyWith(
      status: WatchStatus.loading,
      clearError: true,
    ));
    try {
      final ticket = await repository.issuePlaybackTicket(lectureId);
      emit(state.copyWith(
        status: WatchStatus.loaded,
        ticket: ticket,
        watchedPercent: ticket.watchedPercent,
        recordsProgress: ticket.recordsProgress,
      ));
      _startReporting();
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: WatchStatus.failure,
        error: e,
      ));
    }
  }

  /// Called by the player on each time update.
  void onTimeUpdate(int positionSeconds) {
    if (!state.recordsProgress) return;

    final jump = (positionSeconds - _lastPosition).abs();
    if (_lastPosition >= 0 && jump <= _maxContiguousJump) {
      // Extend the open interval.
      _lastPosition = positionSeconds;
    } else {
      // Seek detected — close the current interval and start a new one.
      if (_openStart >= 0 && _lastPosition > _openStart) {
        _pendingIntervals.add([_openStart, _lastPosition]);
      }
      _openStart = positionSeconds;
      _lastPosition = positionSeconds;
    }
  }

  void _startReporting() {
    _reportTimer?.cancel();
    _reportTimer = Timer.periodic(_reportInterval, (_) => _flush());
  }

  /// Flush pending intervals to the server.
  Future<void> _flush() async {
    if (!state.recordsProgress) return;

    final intervals = _drain();
    if (intervals.isEmpty) return;

    try {
      final result = await repository.reportProgress(
        lectureId,
        positionSeconds: _lastPosition,
        watchedIntervals: intervals,
      );
      final percent = (result['watchedPercent'] as num?)?.toDouble();
      if (!isClosed && percent != null) {
        emit(state.copyWith(watchedPercent: percent));
      }
    } on ApiException {
      // Put them back — a dropped connection must not cost the student
      // the minutes they actually watched.
      _pendingIntervals.insertAll(0, intervals);
    }
  }

  /// Close the open interval and return everything not yet reported.
  List<List<int>> _drain() {
    if (_openStart >= 0 && _lastPosition > _openStart) {
      _pendingIntervals.add([_openStart, _lastPosition]);
    }
    _openStart = _lastPosition;
    final out = List<List<int>>.from(_pendingIntervals);
    _pendingIntervals.clear();
    return out;
  }

  /// Flush immediately on dispose / page close.
  @override
  Future<void> close() async {
    _reportTimer?.cancel();
    await _flush();
    return super.close();
  }
}
