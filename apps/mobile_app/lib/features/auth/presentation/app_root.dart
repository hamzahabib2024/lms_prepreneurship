import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/token_store.dart';
import '../bloc/auth_bloc.dart';
import '../data/repositories/auth_repository.dart';
import 'app_shell.dart';
import 'change_password_page.dart';
import 'login_page.dart';
import 'splash_page.dart';

/// The application shell — the mobile equivalent of the web's AuthProvider +
/// route gate in App.tsx.
///
/// One shared AuthBloc owns the session; this widget decides which screen a
/// given session state lands on:
///   * checking  → splash ("Checking your session…"), never a login flash
///   * signed out → LoginPage
///   * forced password change (FR-REG-040) → ChangePasswordPage, blocking all
///     navigation until the temporary password is replaced
///   * signed in → DashboardPage
class AppRoot extends StatefulWidget {
  const AppRoot({super.key});

  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> {
  late final ApiClient _api;

  @override
  void initState() {
    super.initState();
    _api = ApiClient();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AuthBloc(
        repository: AuthRepository(api: _api),
        api: _api,
        tokenStore: TokenStore.instance,
      )..add(const AppStarted()),
      child: BlocBuilder<AuthBloc, AuthState>(
        builder: (context, state) {
          switch (state.status) {
            case AuthStatus.initial:
            case AuthStatus.loading:
              return const SplashPage();
            case AuthStatus.unauthenticated:
              return const LoginPage();
            case AuthStatus.authenticated:
              if (state.user == null) return const LoginPage();
              if (state.mustChangePassword) {
                return const ChangePasswordPage(forced: true);
              }
              return AppShell(user: state.user!, api: _api);
            case AuthStatus.failure:
              return const LoginPage();
          }
        },
      ),
    );
  }
}