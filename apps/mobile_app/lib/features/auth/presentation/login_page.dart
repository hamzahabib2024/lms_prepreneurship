import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../bloc/auth_bloc.dart';
import 'widgets/login_form.dart';

/// Sign in — SRS §13.11, Figure 9-2.
///
/// NFR-USE-007: every error says what happened and what to do. SEC-AUT-009
/// requires the wrong-password message to be identical whether or not the
/// account exists, so the server sends one message for both and this screen
/// shows it verbatim rather than trying to be more helpful.
class LoginPage extends StatelessWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<AuthBloc, AuthState>(
      builder: (context, state) {
        final error = state.status == AuthStatus.failure ? state.error : null;
        final lockedOut = error?.code == 'AUTH_ACCOUNT_LOCKED';
        final suspended = error?.code == 'AUTH_ACCOUNT_SUSPENDED';
        final api = context.read<ApiClient>();
        return LoginForm(
          error: error,
          lockedOut: lockedOut,
          suspended: suspended,
          isLoading: state.status == AuthStatus.loading,
          api: api,
          onSignIn: (email, password) {
            context.read<AuthBloc>().add(
                  LoginRequested(email: email, password: password),
                );
          },
        );
      },
    );
  }
}