import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/command_palette.dart';
import '../../auth/data/models/auth_session.dart';
import '../../dashboard/presentation/dashboard_page.dart';
import '../../courses/presentation/courses_page.dart';
import '../../admission/review/admissions_page.dart';
import '../../academic/academic_panel.dart';
import '../../certificates/presentation/my_certificates_page.dart';
import '../../certificates/presentation/issuance_page.dart';
import '../../communication/presentation/communication_panel.dart';
import '../../reporting/presentation/reports_page.dart';
import '../../learning/presentation/my_subjects_page.dart';
import '../../fees/presentation/fees_page.dart';

/// Persistent bottom navigation shell for authenticated users.
///
/// Uses [IndexedStack] to preserve page state across tab switches.
/// Tab visibility is role-aware: Admissions for admins, Academic for staff.
///
/// When a role exposes more than five destinations the bottom bar pins the
/// first four and collapses the rest behind a "More" modal sheet so labels
/// stay legible on small screens.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  /// Maximum destinations rendered directly in the bottom bar.
  static const _maxVisible = 5;

  int _selectedIndex = 0;
  int _dashboardRefreshKey = 0;

  bool get _isAdmin => widget.user.isAdmin || widget.user.isSuperAdmin;
  bool get _isStaff => _isAdmin || widget.user.isTeacher;

  List<_TabEntry> get _tabs => [
        _TabEntry(
          icon: Icons.dashboard_outlined,
          activeIcon: Icons.dashboard,
          label: 'Home',
          page: DashboardPage(
            key: ValueKey(_dashboardRefreshKey),
            user: widget.user,
            api: widget.api,
          ),
        ),
        _TabEntry(
          icon: Icons.play_circle_outline,
          activeIcon: Icons.play_circle,
          label: 'Courses',
          page: CoursesPage(api: widget.api, user: widget.user),
        ),
        if (!_isStaff)
          _TabEntry(
            icon: Icons.menu_book_outlined,
            activeIcon: Icons.menu_book,
            label: 'Learning',
            page: MySubjectsPage(api: widget.api),
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
          icon: Icons.payments_outlined,
          activeIcon: Icons.payments,
          label: 'Fees',
          page: FeesPage(user: widget.user, api: widget.api),
        ),
        if (_isStaff)
          _TabEntry(
            icon: Icons.assessment_outlined,
            activeIcon: Icons.assessment,
            label: 'Reports',
            page: ReportsPage(api: widget.api),
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

  /// Indices into [_tabs] that appear as pinned destinations in the bar.
  /// When the tab count exceeds [_maxVisible] the first four are pinned and
  /// the remainder are accessible through the "More" sheet.
  List<int> get _pinnedIndices {
    if (_tabs.length <= _maxVisible) {
      return List<int>.generate(_tabs.length, (i) => i);
    }
    return const [0, 1, 2, 3];
  }

  bool get _needsMore => _tabs.length > _maxVisible;

  int get _moreOverflowCount => _tabs.length - _pinnedIndices.length;

  void _onDestinationSelected(int slot) {
    if (_needsMore && slot == _pinnedIndices.length) {
      _openMoreSheet();
      return;
    }
    final tabIndex = _pinnedIndices[slot];
    setState(() {
      _selectedIndex = tabIndex;
      if (tabIndex == 0) _dashboardRefreshKey++;
    });
    HapticFeedback.lightImpact();
  }

  void _selectTab(int tabIndex) {
    setState(() {
      _selectedIndex = tabIndex;
      if (tabIndex == 0) _dashboardRefreshKey++;
    });
    Navigator.of(context).pop();
    HapticFeedback.lightImpact();
  }

  void _openMoreSheet() {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final barBg = dark ? AppColorsDark.surface : AppColors.surface;
    final lineColor = dark ? AppColorsDark.line : AppColors.line;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final brandBg = dark ? AppColorsDark.brand050 : AppColors.brand050;
    final brandFg = dark ? AppColorsDark.brand600 : AppColors.brand600;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Container(
              decoration: BoxDecoration(
                color: barBg,
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
                border: Border(top: BorderSide(color: lineColor)),
              ),
              child: SafeArea(
                top: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: 10),
                    Center(
                      child: Container(
                        width: 36,
                        height: 4,
                        decoration: BoxDecoration(
                          color: dark
                              ? AppColorsDark.lineStrong
                              : AppColors.lineStrong,
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'More',
                                  style: TextStyle(
                                    fontFamily: AppFonts.display,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: -0.36,
                                    color: ink,
                                    height: 1.3,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '$_moreOverflowCount more section${_moreOverflowCount != 1 ? 's' : ''}',
                                  style: TextStyle(
                                    fontFamily: AppFonts.body,
                                    fontSize: 13,
                                    color: muted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // Search button in More sheet
                          IconButton(
                            icon: const Icon(Icons.search, size: 22),
                            onPressed: () {
                              Navigator.of(context).pop();
                              _openCommandPalette();
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    ...List.generate(_moreOverflowCount, (i) {
                      final tabIndex = _pinnedIndices.length + i;
                      final entry = _tabs[tabIndex];
                      final selected = tabIndex == _selectedIndex;

                      return Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 4),
                        child: Material(
                          color: selected ? brandBg : Colors.transparent,
                          borderRadius:
                              BorderRadius.circular(AppRadius.md),
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            onTap: () {
                              HapticFeedback.lightImpact();
                              _selectTab(tabIndex);
                            },
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 14, vertical: 12),
                              child: Row(
                                children: [
                                  Container(
                                    width: 40,
                                    height: 40,
                                    decoration: BoxDecoration(
                                      color: selected
                                          ? (dark
                                              ? AppColorsDark.surface
                                              : AppColors.surface)
                                          : (dark
                                              ? AppColorsDark.surface2
                                              : AppColors.surface2),
                                      borderRadius: BorderRadius.circular(
                                          AppRadius.sm),
                                    ),
                                    child: Icon(
                                      selected
                                          ? entry.activeIcon
                                          : entry.icon,
                                      size: 20,
                                      color: selected
                                          ? brandFg
                                          : (dark
                                              ? AppColorsDark.muted
                                              : AppColors.muted),
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Text(
                                      entry.label,
                                      style: TextStyle(
                                        fontFamily: AppFonts.body,
                                        fontSize: 15,
                                        fontWeight: selected
                                            ? FontWeight.w600
                                            : FontWeight.w500,
                                        color: selected ? brandFg : ink,
                                      ),
                                    ),
                                  ),
                                  if (selected)
                                    Icon(
                                      Icons.check_circle_rounded,
                                      size: 20,
                                      color: brandFg,
                                    ),
                                  if (!selected)
                                    Icon(
                                      Icons.chevron_right_rounded,
                                      size: 18,
                                      color: dark
                                          ? AppColorsDark.muted
                                          : AppColors.muted,
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                    const SizedBox(height: 6),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _openCommandPalette() {
    CommandPalette.show(
      context,
      api: widget.api,
      user: widget.user,
      onNavigate: (destination) {
        // Map destination to tab index
        final tabIndex = _destinationToTabIndex(destination);
        if (tabIndex != null) {
          setState(() {
            _selectedIndex = tabIndex;
            if (tabIndex == 0) _dashboardRefreshKey++;
          });
        }
      },
    );
  }

  int? _destinationToTabIndex(PaletteDestination destination) {
    switch (destination) {
      case PaletteDestination.dashboard:
        return 0;
      case PaletteDestination.courses:
        return 1;
      case PaletteDestination.learning:
        return _tabs.indexWhere((t) => t.label == 'Learning');
      case PaletteDestination.admissions:
        return _tabs.indexWhere((t) => t.label == 'Admissions');
      case PaletteDestination.academic:
        return _tabs.indexWhere((t) => t.label == 'Academic');
      case PaletteDestination.announcements:
      case PaletteDestination.discussions:
        return _tabs.indexWhere((t) => t.label == 'Alerts');
      case PaletteDestination.fees:
        return _tabs.indexWhere((t) => t.label == 'Fees');
      case PaletteDestination.reports:
        return _tabs.indexWhere((t) => t.label == 'Reports');
      case PaletteDestination.certificates:
        return _tabs.indexWhere((t) => t.label == 'Certificates');
      default:
        return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    // Clamp index if tab count changed (e.g. role mismatch on rebuild).
    final clampedIndex = _selectedIndex.clamp(0, _tabs.length - 1);
    if (clampedIndex != _selectedIndex) {
      _selectedIndex = clampedIndex;
    }

    final tabs = _tabs;
    final pinned = _pinnedIndices;
    final pinnedSlot = pinned.indexOf(_selectedIndex);
    final barSelected = pinnedSlot >= 0 ? pinnedSlot : pinned.length;

    final barBg = dark ? AppColorsDark.surface : AppColors.surface;
    final borderColor = dark ? AppColorsDark.line : AppColors.line;

    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: tabs.map((t) => t.page).toList(),
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: barBg,
          border: Border(
            top: BorderSide(color: borderColor, width: 1),
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0A1A3C5E),
              blurRadius: 8,
              offset: Offset(0, -2),
            ),
            BoxShadow(
              color: Color(0x061A3C5E),
              blurRadius: 4,
              offset: Offset(0, -1),
            ),
          ],
        ),
        child: NavigationBar(
          selectedIndex: barSelected,
          onDestinationSelected: _onDestinationSelected,
          backgroundColor: Colors.transparent,
          elevation: 0,
          surfaceTintColor: Colors.transparent,
          indicatorColor: dark
              ? AppColorsDark.brand600.withValues(alpha: 0.15)
              : AppColors.brand050,
          height: 70,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            for (final idx in pinned)
              NavigationDestination(
                icon: Icon(tabs[idx].icon, size: 22),
                selectedIcon: Icon(tabs[idx].activeIcon, size: 22),
                label: tabs[idx].label,
              ),
            if (_needsMore)
              NavigationDestination(
                icon: Icon(
                  _selectedIndex >= pinned.length
                      ? Icons.menu_open
                      : Icons.menu,
                  size: 22,
                ),
                selectedIcon: Icon(Icons.menu_open, size: 22),
                label: 'More',
              ),
          ],
        ),
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
