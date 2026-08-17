import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/models/auth_session.dart';
import '../data/repositories/auth_repository.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({required AuthRepository repository})
      : _repository = repository,
        super(const AuthState.initial()) {
    on<LoginRequested>(_onLoginRequested);
    on<LogoutRequested>(_onLogoutRequested);
  }

  final AuthRepository _repository;

  Future<void> _onLoginRequested(LoginRequested event, Emitter<AuthState> emit) async {
    emit(state.copyWith(status: AuthStatus.loading, message: null));

    try {
      final session = await _repository.login(
        email: event.email,
        password: event.password,
      );

      if (session.mustChangePassword) {
        emit(
          state.copyWith(
            status: AuthStatus.passwordRequired,
            user: session.user,
            message: 'Please change your password before continuing.',
          ),
        );
        return;
      }

      emit(
        state.copyWith(
          status: AuthStatus.authenticated,
          user: session.user,
          message: null,
        ),
      );
    } catch (error) {
      emit(
        state.copyWith(
          status: AuthStatus.failure,
          message: error.toString().replaceFirst('Exception: ', ''),
        ),
      );
    }
  }

  Future<void> _onLogoutRequested(LogoutRequested event, Emitter<AuthState> emit) async {
    await _repository.logout();
    emit(const AuthState.initial());
  }
}

abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => [];
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

enum AuthStatus {
  initial,
  loading,
  authenticated,
  passwordRequired,
  unauthenticated,
  failure,
}

class AuthState extends Equatable {
  const AuthState({
    this.status = AuthStatus.initial,
    this.user,
    this.message,
  });

  const AuthState.initial()
      : status = AuthStatus.initial,
        user = null,
        message = null;

  final AuthStatus status;
  final AuthUser? user;
  final String? message;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    String? message,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      message: message,
    );
  }

  @override
  List<Object?> get props => [status, user, message];
}
