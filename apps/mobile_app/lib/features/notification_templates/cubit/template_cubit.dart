import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/template_repository.dart';
import '../data/models/template_models.dart';

// ── State ──

class TemplateState extends Equatable {
  const TemplateState({
    this.templates = const [],
    this.loading = false,
    this.error,
    this.success,
  });

  final List<NotificationTemplate> templates;
  final bool loading;
  final String? error;
  final String? success;

  int get customizedCount =>
      templates.where((t) => t.isCustomized).length;

  TemplateState copyWith({
    List<NotificationTemplate>? templates,
    bool? loading,
    String? error,
    String? success,
    bool clearError = false,
    bool clearSuccess = false,
  }) {
    return TemplateState(
      templates: templates ?? this.templates,
      loading: loading ?? this.loading,
      error: clearError ? null : (error ?? this.error),
      success: clearSuccess ? null : (success ?? this.success),
    );
  }

  @override
  List<Object?> get props => [templates, loading, error, success];
}

// ── Cubit ──

class TemplateCubit extends Cubit<TemplateState> {
  TemplateCubit(this._repo) : super(const TemplateState());

  final TemplateRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearError: true, clearSuccess: true));
    try {
      final templates = await _repo.getAll();
      emit(state.copyWith(templates: templates, loading: false));
    } catch (e) {
      emit(state.copyWith(loading: false, error: 'Failed to load: $e'));
    }
  }

  Future<void> save({
    required String kind,
    required String title,
    required String body,
  }) async {
    emit(state.copyWith(clearError: true, clearSuccess: true));
    try {
      await _repo.save(kind: kind, title: title, body: body);
      emit(state.copyWith(success: 'Template saved'));
      await load();
    } catch (e) {
      emit(state.copyWith(error: 'Save failed: $e'));
    }
  }

  Future<void> reset(String kind) async {
    emit(state.copyWith(clearError: true, clearSuccess: true));
    try {
      await _repo.reset(kind);
      emit(state.copyWith(success: 'Template reset to default'));
      await load();
    } catch (e) {
      emit(state.copyWith(error: 'Reset failed: $e'));
    }
  }
}
