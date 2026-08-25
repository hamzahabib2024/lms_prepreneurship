import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/public_page_repository.dart';
import '../data/models/public_page_models.dart';

// ── State ──

class PublicPageState extends Equatable {
  const PublicPageState({
    this.doc,
    this.draft = const {},
    this.loading = false,
    this.saving = false,
    this.error,
    this.success,
    this.fieldErrors = const {},
  });

  final PublicDocument? doc;
  final Map<String, dynamic> draft;
  final bool loading;
  final bool saving;
  final String? error;
  final String? success;
  final Map<String, String> fieldErrors;

  int get changeCount {
    if (doc == null) return 0;
    int count = 0;
    for (final key in draft.keys) {
      final field = doc!.fields.where((f) => f.key == key).firstOrNull;
      if (field == null) continue;
      final serverValue = field.value;
      final draftValue = draft[key];
      if (draftValue == null && field.isOverridden) {
        count++;
      } else if (draftValue != null &&
          draftValue.toString() != (serverValue ?? field.defaultValue).toString()) {
        count++;
      }
    }
    return count;
  }

  bool get hasChanges => changeCount > 0;

  PublicPageState copyWith({
    PublicDocument? doc,
    Map<String, dynamic>? draft,
    bool? loading,
    bool? saving,
    String? error,
    String? success,
    Map<String, String>? fieldErrors,
    bool clearError = false,
    bool clearSuccess = false,
    bool clearDraft = false,
  }) {
    return PublicPageState(
      doc: doc ?? this.doc,
      draft: clearDraft ? {} : (draft ?? this.draft),
      loading: loading ?? this.loading,
      saving: saving ?? this.saving,
      error: clearError ? null : (error ?? this.error),
      success: clearSuccess ? null : (success ?? this.success),
      fieldErrors: fieldErrors ?? this.fieldErrors,
    );
  }

  @override
  List<Object?> get props => [doc, draft, loading, saving, error, success, fieldErrors];
}

// ── Cubit ──

class PublicPageCubit extends Cubit<PublicPageState> {
  PublicPageCubit(this._repo) : super(const PublicPageState());

  final PublicPageRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearError: true));
    try {
      final doc = await _repo.getDocument();
      emit(state.copyWith(doc: doc, loading: false));
    } catch (e) {
      emit(state.copyWith(loading: false, error: 'Failed to load: $e'));
    }
  }

  void setDraft(String key, dynamic value) {
    final newDraft = Map<String, dynamic>.from(state.draft);
    newDraft[key] = value;
    emit(state.copyWith(
      draft: newDraft,
      clearError: true,
      clearSuccess: true,
    ));
  }

  void restoreDefault(String key) {
    final newDraft = Map<String, dynamic>.from(state.draft);
    newDraft[key] = null; // null = restore default
    emit(state.copyWith(draft: newDraft));
  }

  dynamic currentValue(String key) {
    if (state.draft.containsKey(key)) {
      return state.draft[key];
    }
    final field = state.doc?.fields.where((f) => f.key == key).firstOrNull;
    return field?.currentValue;
  }

  Future<void> save() async {
    if (!state.hasChanges || state.saving) return;

    emit(state.copyWith(saving: true, clearError: true, clearSuccess: true));

    // Build the values map: only changed fields
    final values = <String, dynamic>{};
    for (final key in state.draft.keys) {
      final field = state.doc?.fields.where((f) => f.key == key).firstOrNull;
      if (field == null) continue;
      final draftValue = state.draft[key];
      final serverValue = field.value;

      if (draftValue == null && field.isOverridden) {
        values[key] = null; // restore default
      } else if (draftValue != null &&
          draftValue.toString() != (serverValue ?? field.defaultValue).toString()) {
        values[key] = draftValue;
      }
    }

    if (values.isEmpty) {
      emit(state.copyWith(saving: false));
      return;
    }

    try {
      final result = await _repo.save(values);
      final note = result.changed.isEmpty && result.restored.isEmpty
          ? 'No changes'
          : '${result.changed.length} updated, ${result.restored.length} restored';
      emit(state.copyWith(saving: false, success: note, clearDraft: true));
      await load(); // refresh from server
    } catch (e) {
      emit(state.copyWith(saving: false, error: 'Save failed: $e'));
    }
  }
}
