import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_exception.dart';
import '../data/live_class_repository.dart';
import '../data/models/live_class_models.dart';

class StartClassState extends Equatable {
  const StartClassState({
    this.loading = true,
    this.options = const [],
    this.sectionSubjectId,
    this.minutes = 60,
    this.busy = false,
    this.started,
    this.error,
  });

  final bool loading;
  final List<TeachingAssignment> options;
  final String? sectionSubjectId;
  final int minutes;
  final bool busy;
  final StartedClass? started;
  final ApiException? error;

  /// Nothing to teach and nothing to offer. The card renders as absent rather
  /// than as a disabled control, because a student or an administrator being
  /// shown a class they cannot start reads as broken, not as unavailable.
  bool get hasNothingToOffer => !loading && options.isEmpty;

  bool get canStart => sectionSubjectId != null && !busy;

  @override
  List<Object?> get props =>
      [loading, options, sectionSubjectId, minutes, busy, started, error];

  StartClassState copyWith({
    bool? loading,
    List<TeachingAssignment>? options,
    String? sectionSubjectId,
    int? minutes,
    bool? busy,
    StartedClass? started,
    ApiException? error,
    bool clearError = false,
  }) {
    return StartClassState(
      loading: loading ?? this.loading,
      options: options ?? this.options,
      sectionSubjectId: sectionSubjectId ?? this.sectionSubjectId,
      minutes: minutes ?? this.minutes,
      busy: busy ?? this.busy,
      started: started ?? this.started,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class StartClassCubit extends Cubit<StartClassState> {
  StartClassCubit(this._repo) : super(const StartClassState());

  final LiveClassRepository _repo;

  Future<void> load() async {
    try {
      final options = await _repo.myTeaching();
      if (isClosed) return;
      emit(state.copyWith(
        loading: false,
        options: options,
        // One assignment is not a choice. Pre-selecting it removes the only
        // field a teacher would otherwise have to fill in.
        sectionSubjectId:
            options.length == 1 ? options.first.sectionSubjectId : null,
      ));
    } on ApiException {
      // A refusal here means no live_session:create, which for this card is
      // the same answer as "nothing to teach". It is not an error to report.
      if (isClosed) return;
      emit(state.copyWith(loading: false, options: const []));
    }
  }

  void chooseClass(String sectionSubjectId) =>
      emit(state.copyWith(sectionSubjectId: sectionSubjectId, clearError: true));

  void chooseDuration(int minutes) => emit(state.copyWith(minutes: minutes));

  Future<void> start() async {
    final id = state.sectionSubjectId;
    if (id == null) return;
    emit(state.copyWith(busy: true, clearError: true));
    try {
      final started =
          await _repo.startNow(sectionSubjectId: id, durationMinutes: state.minutes);
      if (isClosed) return;
      emit(state.copyWith(busy: false, started: started));
    } on ApiException catch (e) {
      if (isClosed) return;
      // The clash check speaks plainly — "you already have X at that time" is
      // exactly what a teacher needs to read — so it is shown as sent.
      emit(state.copyWith(busy: false, error: e));
    }
  }
}
