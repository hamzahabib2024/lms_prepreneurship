import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../auth/data/models/auth_session.dart';

class DashboardBloc extends Bloc<DashboardEvent, DashboardState> {
  DashboardBloc({required AuthUser user}) : super(DashboardState.initial(user: user)) {
    on<DashboardTabChanged>((event, emit) {
      emit(state.copyWith(selectedTabIndex: event.index));
    });
  }
}

abstract class DashboardEvent extends Equatable {
  const DashboardEvent();

  @override
  List<Object?> get props => [];
}

class DashboardTabChanged extends DashboardEvent {
  const DashboardTabChanged(this.index);

  final int index;

  @override
  List<Object?> get props => [index];
}

class DashboardState extends Equatable {
  const DashboardState({
    required this.user,
    this.selectedTabIndex = 0,
  });

  factory DashboardState.initial({required AuthUser user}) {
    return DashboardState(user: user);
  }

  final AuthUser user;
  final int selectedTabIndex;

  DashboardState copyWith({
    AuthUser? user,
    int? selectedTabIndex,
  }) {
    return DashboardState(
      user: user ?? this.user,
      selectedTabIndex: selectedTabIndex ?? this.selectedTabIndex,
    );
  }

  String get roleLabel {
    final roles = user.roles;
    if (roles.contains('super_admin')) return 'Super Admin';
    if (roles.contains('admin')) return 'Administrator';
    if (roles.contains('teacher')) return 'Teacher';
    return 'Student';
  }

  List<DashboardQuickAction> get quickActions {
    switch (roleLabel) {
      case 'Student':
        return [
          const DashboardQuickAction(title: 'My Subjects', icon: Icons.book_outlined),
          const DashboardQuickAction(title: 'Timetable', icon: Icons.calendar_month_outlined),
          const DashboardQuickAction(title: 'Fees', icon: Icons.account_balance_wallet_outlined),
          const DashboardQuickAction(title: 'Progress', icon: Icons.trending_up_outlined),
        ];
      case 'Teacher':
        return [
          const DashboardQuickAction(title: 'Attendance', icon: Icons.check_circle_outline),
          const DashboardQuickAction(title: 'Marking', icon: Icons.edit_document),
          const DashboardQuickAction(title: 'Content', icon: Icons.video_library_outlined),
          const DashboardQuickAction(title: 'Reports', icon: Icons.bar_chart_outlined),
        ];
      case 'Administrator':
      case 'Super Admin':
        return [
          const DashboardQuickAction(title: 'Admissions', icon: Icons.how_to_reg_outlined),
          const DashboardQuickAction(title: 'People', icon: Icons.group_outlined),
          const DashboardQuickAction(title: 'Reports', icon: Icons.assessment_outlined),
          const DashboardQuickAction(title: 'Settings', icon: Icons.settings_outlined),
        ];
      default:
        return [
          const DashboardQuickAction(title: 'Overview', icon: Icons.dashboard_outlined),
        ];
    }
  }

  List<SummaryMetric> get metrics {
    switch (roleLabel) {
      case 'Student':
        return const [
          SummaryMetric(label: 'Courses', value: '6'),
          SummaryMetric(label: 'Attendance', value: '92%'),
          SummaryMetric(label: 'Fees', value: 'Paid'),
        ];
      case 'Teacher':
        return const [
          SummaryMetric(label: 'Classes', value: '4'),
          SummaryMetric(label: 'Tasks', value: '18'),
          SummaryMetric(label: 'Reports', value: '3'),
        ];
      case 'Administrator':
      case 'Super Admin':
        return const [
          SummaryMetric(label: 'Students', value: '320'),
          SummaryMetric(label: 'Pending', value: '14'),
          SummaryMetric(label: 'Revenue', value: 'PKR 4.2M'),
        ];
      default:
        return const [
          SummaryMetric(label: 'Status', value: 'OK'),
        ];
    }
  }

  @override
  List<Object?> get props => [user, selectedTabIndex];
}

class DashboardQuickAction extends Equatable {
  const DashboardQuickAction({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  List<Object?> get props => [title, icon];
}

class SummaryMetric extends Equatable {
  const SummaryMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  List<Object?> get props => [label, value];
}
