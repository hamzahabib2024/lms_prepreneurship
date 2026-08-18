import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/token_store.dart';
import '../data/models/auth_session.dart';
import '../data/repositories/auth_repository.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    required AuthRepository repository,
    required ApiClient api,
    required TokenStore tokenStore,
  })  : _repository = repository,
        _api = api,
        _tokenStore = tokenStore,
        super(const AuthState.initial()) {
    on<AppStarted>(_onAppStarted);
    on<LoginRequested>(_onLoginRequested);
    on<LogoutRequested>(_onLogoutRequested);
    on<SessionExpired>(_onSessionExpired);

    // A failed refresh anywhere in the app ends the session — the mobile
    // equivalent of the web client's setUnauthenticatedHandler.
    _api.onUnauthenticated = () => add(const SessionExpired());
  }

  final AuthRepository _repository;
  final ApiClient _api;
  final TokenStore _tokenStore;

  /// Restores a session on a cold start. The access token lives in memory
  /// only, so the app always begins without one; the refresh token in
  /// storage is what makes the session survive, and /auth/me is what proves
  /// it is still valid — the server may have revoked it since the app was
  /// last open.
  Future<void> _onAppStarted(AppStarted event, Emitter<AuthState> emit) async {
    await _tokenStore.init();

    if (_tokenStore.refreshToken == null) {
      emit(const AuthState.unauthenticated());
      return;
    }

    try {
      final me = await _repository.me();
      emit(
        AuthState(
          status: AuthStatus.authenticated,
          user: me.user,
          mustChangePassword: me.mustChangePassword,
        ),
      );
    } on ApiException {
      _tokenStore.clear();
      emit(const AuthState.unauthenticated());
    }
  }

  Future<void> _onLoginRequested(LoginRequested event, Emitter<AuthState> emit) async {
    emit(state.copyWith(status: AuthStatus.loading, error: null));

    try {
      final session = await _repository.login(
        email: event.email,
        password: event.password,
      );

      _tokenStore.accessToken = session.accessToken;
      _tokenStore.setRefreshToken(session.refreshToken);

      emit(
        AuthState(
          status: AuthStatus.authenticated,
          user: session.user,
          mustChangePassword: session.mustChangePassword,
        ),
      );
    } on ApiException catch (error) {
      emit(
        state.copyWith(
          status: AuthStatus.failure,
          error: error,
        ),
      );
    }
  }

  Future<void> _onLogoutRequested(LogoutRequested event, Emitter<AuthState> emit) async {
    await _repository.logout();
    _tokenStore.clear();
    emit(const AuthState.unauthenticated());
  }

  /// A direct, awaitable password change — the page needs to know it
  /// succeeded to pop itself back when the change was voluntary, and a
  /// post-change emit is structurally identical to the pre-change state in
  /// that case, so the page cannot observe it through the stream.
  ///
  /// Success flips `mustChangePassword`, which is what lets a forced-change
  /// session through the gate (FR-REG-040).
  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    // ignore: invalid_use_of_visible_for_testing_member
    emit(state.copyWith(error: null));

    try {
      await _repository.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      // ignore: invalid_use_of_visible_for_testing_member
      emit(state.copyWith(mustChangePassword: false));
      return true;
    } on ApiException catch (error) {
      final fieldMessage = error.fieldError('newPassword') ?? error.message;
      // ignore: invalid_use_of_visible_for_testing_member
      emit(
        state.copyWith(
          error: ApiException(
            status: error.status,
            code: error.code,
            message: fieldMessage,
            reference: error.reference,
          ),
        ),
      );
      return false;
    }
  }

  Future<void> _onSessionExpired(SessionExpired event, Emitter<AuthState> emit) async {
    _tokenStore.clear();
    emit(const AuthState.unauthenticated());
  }

  @override
  Future<void> close() {
    _api.onUnauthenticated = null;
    return super.close();
  }
}

// ---------------------------------------------------------------- events ---

abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => [];
}

class AppStarted extends AuthEvent {
  const AppStarted();
}

class LoginRequested extends AuthEvent {
  const LoginRequested({required this.email, required this.password});

  final String email;
  final String password;

  @override
  List<Object?> get props => [email, password];
}

class LogoutRequested extends AuthEvent {
  const LogoutRequested();
}

class SessionExpired extends AuthEvent {
  const SessionExpired();
}

// ---------------------------------------------------------------- state ----

enum AuthStatus {
  /// The shell is checking for a stored session ("Checking your session…").
  initial,
  unauthenticated,
  loading,
  authenticated,
  failure,
}

class AuthState extends Equatable {
  const AuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.mustChangePassword = false,
    this.error,
  });

  const AuthState.initial()
      : status = AuthStatus.initial,
        user = null,
        mustChangePassword = false,
        error = null;

  const AuthState.unauthenticated()
      : status = AuthStatus.unauthenticated,
        user = null,
        mustChangePassword = false,
        error = null;

  final AuthStatus status;
  final AuthUser? user;
  final bool mustChangePassword;

  /// The last failure, with its code/reference intact so screens can branch
  /// on the account state (locked vs suspended) and quote the reference.
  final ApiException? error;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    bool? mustChangePassword,
    ApiException? error,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      mustChangePassword: mustChangePassword ?? this.mustChangePassword,
      error: error,
    );
  }

  @override
  List<Object?> get props => [status, user, mustChangePassword, error];
}