import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import '../../dashboard/presentation/dashboard_page.dart';
import '../../courses/presentation/courses_page.dart';
import '../../admission/review/admissions_page.dart';
import '../../academic/academic_panel.dart';
import '../../certificates/presentation/my_certificates_page.dart';
import '../../certificates/presentation/issuance_page.dart';
import '../../communication/presentation/communication_panel.dart';

/// Persistent bottom navigation shell for authenticated users.
///
/// Uses [IndexedStack] to preserve page state across tab switches.
/// Tab visibility is role-aware: Admissions for admins, Academic for staff.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _selectedIndex = 0;

  bool get _isAdmin => widget.user.isAdmin || widget.user.isSuperAdmin;
  bool get _isStaff => _isAdmin || widget.user.isTeacher;

  List<_TabEntry> get _tabs => [
        _TabEntry(
          icon: Icons.dashboard_outlined,
          activeIcon: Icons.dashboard,
          label: 'Home',
          page: DashboardPage(user: widget.user, api: widget.api),
        ),
        _TabEntry(
          icon: Icons.play_circle_outline,
          activeIcon: Icons.play_circle,
          label: 'Courses',
          page: CoursesPage(api: widget.api, user: widget.user),
        ),
        if (_isAdmin)
          _TabEntry(
            icon: Icons.how_to_reg_outlined,
            activeIcon: Icons.how_to_reg,
            label: 'Admissions',
            page: AdmissionsPage(api: widget.api),
          ),
        if (_isStaff)
          _TabEntry(
            icon: Icons.school_outlined,
            activeIcon: Icons.school,
            label: 'Academic',
            page: AcademicPanel(user: widget.user, api: widget.api),
          ),
        _TabEntry(
          icon: Icons.notifications_outlined,
          activeIcon: Icons.notifications,
          label: 'Alerts',
          page: CommunicationPanel(api: widget.api, user: widget.user),
        ),
        _TabEntry(
          icon: Icons.emoji_events_outlined,
          activeIcon: Icons.emoji_events,
          label: 'Certificates',
          page: _isAdmin
              ? IssuancePage(api: widget.api, user: widget.user)
              : MyCertificatesPage(api: widget.api),
        ),
      ];

  void _onTabTapped(int index) {
    setState(() => _selectedIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    // Clamp index if tab count changed (e.g. role mismatch on rebuild).
    final clampedIndex = _selectedIndex.clamp(0, _tabs.length - 1);
    if (clampedIndex != _selectedIndex) {
      _selectedIndex = clampedIndex;
    }

    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: _tabs.map((t) => t.page).toList(),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: _onTabTapped,
        backgroundColor: dark ? AppColorsDark.surface : AppColors.surface,
        indicatorColor: dark
            ? AppColorsDark.brand600.withValues(alpha: 0.15)
            : AppColors.brand050,
        height: 64,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(
              icon: Icon(tab.icon, size: 22),
              selectedIcon: Icon(tab.activeIcon, size: 22),
              label: tab.label,
            ),
        ],
      ),
    );
  }
}

class _TabEntry {
  const _TabEntry({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.page,
  });

  final IconData icon;
  final IconData activeIcon;
  final String label;
  final Widget page;
}
