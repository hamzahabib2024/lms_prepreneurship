import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../auth/data/models/auth_session.dart';
import '../bloc/dashboard_bloc.dart';
import 'widgets/dashboard_body.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key, required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => DashboardBloc(user: user),
      child: const DashboardScreen(),
    );
  }
}

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: BlocBuilder<DashboardBloc, DashboardState>(
          builder: (context, state) {
            return DashboardBody(
              user: state.user,
              selectedTabIndex: state.selectedTabIndex,
              quickActions: state.quickActions,
              metrics: state.metrics,
              roleLabel: state.roleLabel,
              onTabChanged: (index) {
                context.read<DashboardBloc>().add(DashboardTabChanged(index));
              },
            );
          },
        ),
      ),
    );
  }
}
