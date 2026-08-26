import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../network/api_client.dart';
import '../theme/app_theme.dart';
import '../../features/auth/data/repositories/auth_repository.dart';

class MaintenanceModeScreen extends StatelessWidget {
  const MaintenanceModeScreen({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return BlocProvider(
      create: (_) => _MaintenanceCubit(api: api)..check(),
      child: BlocBuilder<_MaintenanceCubit, _MaintenanceState>(
        builder: (context, state) {
          if (state.loading) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }

          if (!state.maintenanceMode) {
            return const SizedBox.shrink();
          }

          return Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(40),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.build_circle_outlined,
                      size: 72,
                      color: AppColors.warn,
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Down for Maintenance',
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      state.message.isNotEmpty
                          ? state.message
                          : 'We are currently performing scheduled maintenance. Please try again later.',
                      style: TextStyle(color: muted, fontSize: 15),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 32),
                    FilledButton.icon(
                      onPressed: () => context.read<_MaintenanceCubit>().check(),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Check again'),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () {
                        context.read<AuthRepository>().logout();
                      },
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _MaintenanceCubit extends Cubit<_MaintenanceState> {
  _MaintenanceCubit({required this.api}) : super(const _MaintenanceState());
  final ApiClient api;

  Future<void> check() async {
    emit(state.copyWith(loading: true));
    try {
      final data = await api.get<Map<String, dynamic>>('/maintenance');
      emit(state.copyWith(
        loading: false,
        maintenanceMode: data['enabled'] == true,
        message: data['message'] as String? ?? '',
      ));
    } catch (e) {
      emit(state.copyWith(loading: false));
    }
  }
}

class _MaintenanceState {
  const _MaintenanceState({
    this.loading = false,
    this.maintenanceMode = false,
    this.message = '',
  });

  final bool loading;
  final bool maintenanceMode;
  final String message;

  _MaintenanceState copyWith({
    bool? loading,
    bool? maintenanceMode,
    String? message,
  }) {
    return _MaintenanceState(
      loading: loading ?? this.loading,
      maintenanceMode: maintenanceMode ?? this.maintenanceMode,
      message: message ?? this.message,
    );
  }
}
