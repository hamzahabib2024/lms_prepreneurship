import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class PreferencesState extends Equatable {
  const PreferencesState({
    this.status = PreferencesStatus.loading,
    this.preference,
    this.error,
    this.saving = false,
    this.savedMessage,
  });

  final PreferencesStatus status;
  final NotificationPreference? preference;
  final ApiException? error;
  final bool saving;
  final String? savedMessage;

  PreferencesState copyWith({
    PreferencesStatus? status,
    NotificationPreference? preference,
    ApiException? error,
    bool? saving,
    String? savedMessage,
    bool clearError = false,
    bool clearSaved = false,
  }) =>
      PreferencesState(
        status: status ?? this.status,
        preference: preference ?? this.preference,
        error: clearError ? null : (error ?? this.error),
        saving: saving ?? this.saving,
        savedMessage: clearSaved ? null : (savedMessage ?? this.savedMessage),
      );

  @override
  List<Object?> get props => [status, preference, error, saving, savedMessage];
}

enum PreferencesStatus { loading, loaded, failure }

class PreferencesCubit extends Cubit<PreferencesState> {
  PreferencesCubit({required this.repository})
      : super(const PreferencesState());

  final CommunicationRepository repository;

  Future<void> load() async {
    emit(state.copyWith(status: PreferencesStatus.loading, clearError: true));
    try {
      final pref = await repository.myPreference();
      emit(state.copyWith(
        status: PreferencesStatus.loaded,
        preference: pref,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: PreferencesStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> toggleChannel(String channel, bool enabled) async {
    final current = state.preference;
    if (current == null) return;

    final channels = List<String>.from(current.channels);
    if (enabled) {
      if (!channels.contains(channel)) channels.add(channel);
    } else {
      channels.remove(channel);
    }

    await _save(channels: channels);
  }

  Future<void> setQuietHours(int? start, int? end) async {
    await _save(quietHoursStart: start, quietHoursEnd: end);
  }

  Future<void> clearQuietHours() async {
    await _save(clearQuietHours: true);
  }

  Future<void> _save({
    List<String>? channels,
    int? quietHoursStart,
    int? quietHoursEnd,
    bool clearQuietHours = false,
  }) async {
    emit(state.copyWith(saving: true, clearError: true, clearSaved: true));
    try {
      final updated = await repository.updatePreference(
        channels: channels,
        quietHoursStart: quietHoursStart,
        quietHoursEnd: quietHoursEnd,
        clearQuietHours: clearQuietHours,
      );
      emit(state.copyWith(
        saving: false,
        preference: updated,
        savedMessage: 'Preferences saved.',
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(saving: false, error: e));
    }
  }
}
