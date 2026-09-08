import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/signatories_repository.dart';

class SignatoriesCubit extends Cubit<SignatoriesState> {
  SignatoriesCubit({required this.repository}) : super(const SignatoriesState());

  final SignatoriesRepository repository;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final signatories = await repository.list();
      if (isClosed) return;
      emit(state.copyWith(loading: false, signatories: signatories));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  Future<void> add({
    required String name,
    required String designation,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.create(name: name, designation: designation);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: '$name added.'));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> remove({required String id, required String name}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.remove(id: id);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: '$name removed.'));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> toggleActive({required String id, required bool isActive}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.update(id: id, isActive: !isActive);
      if (isClosed) return;
      emit(state.copyWith(
        busy: false,
        actionSuccess: isActive
            ? 'Will not appear on new certificates.'
            : 'Back in use.',
      ));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> reorder({required String id, required int sortOrder}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.update(id: id, sortOrder: sortOrder);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Order changed.'));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void dismissResult() {
    emit(state.copyWith(clearActionSuccess: true, clearActionError: true));
  }
}

class SignatoriesState extends Equatable {
  const SignatoriesState({
    this.loading = false,
    this.signatories = const [],
    this.error,
    this.busy = false,
    this.actionError,
    this.actionSuccess,
  });

  final bool loading;
  final List<Signatory> signatories;
  final ApiException? error;
  final bool busy;
  final ApiException? actionError;
  final String? actionSuccess;

  SignatoriesState copyWith({
    bool? loading,
    List<Signatory>? signatories,
    ApiException? error,
    bool? busy,
    ApiException? actionError,
    String? actionSuccess,
    bool clearActionSuccess = false,
    bool clearActionError = false,
  }) {
    return SignatoriesState(
      loading: loading ?? this.loading,
      signatories: signatories ?? this.signatories,
      error: error,
      busy: busy ?? this.busy,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      actionSuccess:
          clearActionSuccess ? null : (actionSuccess ?? this.actionSuccess),
    );
  }

  @override
  List<Object?> get props => [
        loading,
        signatories,
        error,
        busy,
        actionError,
        actionSuccess,
      ];
}
