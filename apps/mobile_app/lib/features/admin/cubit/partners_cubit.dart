import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/models/partner.dart';
import '../data/partner_repository.dart';

class PartnersCubit extends Cubit<PartnersState> {
  PartnersCubit({required this.repository}) : super(const PartnersState());

  final PartnerRepository repository;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final partners = await repository.listPartners();
      if (isClosed) return;
      emit(state.copyWith(loading: false, partners: partners));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  Future<void> createPartner({
    required String name,
    required String code,
    required String billingMode,
    String? city,
    String? contactName,
    String? contactEmail,
    String? contactPhone,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.createPartner(
        name: name,
        code: code,
        billingMode: billingMode,
        city: city,
        contactName: contactName,
        contactEmail: contactEmail,
        contactPhone: contactPhone,
      );
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Institute added'));
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
      await repository.updatePartner(id: id, isActive: !isActive);
      if (isClosed) return;
      emit(state.copyWith(
        busy: false,
        actionSuccess: isActive ? 'Marked inactive' : 'Reactivated',
      ));
      await load();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> createAccount({
    required String partnerId,
    required String partnerName,
    required String fullName,
    required String email,
    String? phone,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final account = await repository.createPartnerAccount(
        partnerId: partnerId,
        fullName: fullName,
        email: email,
        phone: phone,
      );
      if (isClosed) return;
      emit(state.copyWith(busy: false, createdAccount: account));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void dismissResult() {
    emit(state.copyWith(
      clearActionSuccess: true,
      clearActionError: true,
      clearCreatedAccount: true,
    ));
  }
}

class PartnersState extends Equatable {
  const PartnersState({
    this.loading = false,
    this.partners = const [],
    this.error,
    this.busy = false,
    this.actionError,
    this.actionSuccess,
    this.createdAccount,
  });

  final bool loading;
  final List<Partner> partners;
  final ApiException? error;
  final bool busy;
  final ApiException? actionError;
  final String? actionSuccess;
  final PartnerAccount? createdAccount;

  PartnersState copyWith({
    bool? loading,
    List<Partner>? partners,
    ApiException? error,
    bool? busy,
    ApiException? actionError,
    String? actionSuccess,
    bool clearActionSuccess = false,
    bool clearActionError = false,
    PartnerAccount? createdAccount,
    bool clearCreatedAccount = false,
  }) {
    return PartnersState(
      loading: loading ?? this.loading,
      partners: partners ?? this.partners,
      error: error,
      busy: busy ?? this.busy,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      actionSuccess:
          clearActionSuccess ? null : (actionSuccess ?? this.actionSuccess),
      createdAccount:
          clearCreatedAccount ? null : (createdAccount ?? this.createdAccount),
    );
  }

  @override
  List<Object?> get props => [
        loading,
        partners,
        error,
        busy,
        actionError,
        actionSuccess,
        createdAccount,
      ];
}
