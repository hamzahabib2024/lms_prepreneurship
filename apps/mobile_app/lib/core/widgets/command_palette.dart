import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../network/api_client.dart';
import '../theme/app_theme.dart';
import '../../features/auth/data/models/auth_session.dart';

/// A quick-search command palette for navigating to any feature.
///
/// Shows a full-screen search overlay with fuzzy matching across all
/// available destinations. Triggered from the app bar search icon or
/// a keyboard shortcut on tablets.
class CommandPalette extends StatefulWidget {
  const CommandPalette({
    super.key,
    required this.api,
    required this.user,
    required this.onNavigate,
  });

  final ApiClient api;
  final AuthUser user;
  final ValueChanged<PaletteAction> onNavigate;

  static Future<void> show(
    BuildContext context, {
    required ApiClient api,
    required AuthUser user,
    required ValueChanged<PaletteAction> onNavigate,
  }) {
    return Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black54,
        transitionDuration: const Duration(milliseconds: 150),
        pageBuilder: (_, __, ___) => CommandPalette(
          api: api,
          user: user,
          onNavigate: onNavigate,
        ),
        transitionsBuilder: (_, animation, __, child) {
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0, -0.05),
                end: Offset.zero,
              ).animate(CurvedAnimation(
                parent: animation,
                curve: Curves.easeOut,
              )),
              child: child,
            ),
          );
        },
      ),
    );
  }

  @override
  State<CommandPalette> createState() => _CommandPaletteState();
}

class _CommandPaletteState extends State<CommandPalette> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  List<_PaletteEntry> _results = [];
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _results = _buildEntries();
    _focusNode.requestFocus();
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  List<_PaletteEntry> _buildEntries() {
    final user = widget.user;
    final isAdmin = user.isAdmin || user.isSuperAdmin;
    final isStaff = isAdmin || user.isTeacher;

    return [
      _PaletteEntry(
        label: 'Dashboard',
        icon: Icons.dashboard_outlined,
        destination: PaletteDestination.dashboard,
        roles: const ['*'],
      ),
      _PaletteEntry(
        label: 'My Courses',
        icon: Icons.play_circle_outline,
        destination: PaletteDestination.courses,
        roles: const ['*'],
      ),
      if (!isStaff)
        _PaletteEntry(
          label: 'My Subjects',
          icon: Icons.menu_book_outlined,
          destination: PaletteDestination.learning,
          roles: const ['student'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Admissions',
          icon: Icons.how_to_reg_outlined,
          destination: PaletteDestination.admissions,
          roles: const ['admin', 'super_admin'],
        ),
      if (isStaff)
        _PaletteEntry(
          label: 'Academic',
          icon: Icons.school_outlined,
          destination: PaletteDestination.academic,
          roles: const ['admin', 'super_admin', 'teacher'],
        ),
      _PaletteEntry(
        label: 'Announcements',
        icon: Icons.campaign_outlined,
        destination: PaletteDestination.announcements,
        roles: const ['*'],
      ),
      _PaletteEntry(
        label: 'Discussions',
        icon: Icons.forum_outlined,
        destination: PaletteDestination.discussions,
        roles: const ['*'],
      ),
      _PaletteEntry(
        label: 'Fees',
        icon: Icons.payments_outlined,
        destination: PaletteDestination.fees,
        roles: const ['*'],
      ),
      if (isStaff)
        _PaletteEntry(
          label: 'Reports',
          icon: Icons.assessment_outlined,
          destination: PaletteDestination.reports,
          roles: const ['admin', 'super_admin', 'teacher'],
        ),
      _PaletteEntry(
        label: 'Certificates',
        icon: Icons.emoji_events_outlined,
        destination: PaletteDestination.certificates,
        roles: const ['*'],
      ),
      if (isStaff)
        _PaletteEntry(
          label: 'Marking Queue',
          icon: Icons.grading_outlined,
          destination: PaletteDestination.marking,
          roles: const ['admin', 'super_admin', 'teacher'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Users',
          icon: Icons.people_outlined,
          destination: PaletteDestination.users,
          roles: const ['admin', 'super_admin'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Settings',
          icon: Icons.settings_outlined,
          destination: PaletteDestination.settings,
          roles: const ['admin', 'super_admin'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Backups',
          icon: Icons.backup_outlined,
          destination: PaletteDestination.backups,
          roles: const ['super_admin'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Audit Log',
          icon: Icons.history_outlined,
          destination: PaletteDestination.audit,
          roles: const ['super_admin'],
        ),
      if (isAdmin)
        _PaletteEntry(
          label: 'Security',
          icon: Icons.shield_outlined,
          destination: PaletteDestination.security,
          roles: const ['super_admin'],
        ),
    ];
  }

  void _filter(String query) {
    setState(() {
      if (query.isEmpty) {
        _results = _buildEntries();
      } else {
        final q = query.toLowerCase();
        _results = _buildEntries()
            .where((e) => e.label.toLowerCase().contains(q))
            .toList();
      }
      _selectedIndex = 0;
    });
  }

  void _select(int index) {
    if (index < 0 || index >= _results.length) return;
    widget.onNavigate(_results[index].destination);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 60, 16, 40),
      child: Material(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        clipBehavior: Clip.antiAlias,
        elevation: 24,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Search input
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: dark ? AppColorsDark.line : AppColors.line,
                  ),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.search,
                    size: 22,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      focusNode: _focusNode,
                      decoration: InputDecoration(
                        hintText: 'Search pages\u2026',
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 0, vertical: 14),
                        hintStyle: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                      onChanged: _filter,
                      onSubmitted: (_) => _select(_selectedIndex),
                    ),
                  ),
                  if (_controller.text.isNotEmpty)
                    IconButton(
                      icon: const Icon(Icons.clear, size: 18),
                      onPressed: () {
                        _controller.clear();
                        _filter('');
                      },
                    ),
                ],
              ),
            ),
            // Results
            if (_results.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No matching pages',
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 14,
                  ),
                ),
              )
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: _results.length,
                  itemBuilder: (context, i) {
                    final entry = _results[i];
                    final selected = i == _selectedIndex;
                    return _PaletteResultTile(
                      entry: entry,
                      selected: selected,
                      onTap: () => _select(i),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Models ──

class _PaletteEntry {
  const _PaletteEntry({
    required this.label,
    required this.icon,
    required this.destination,
    required this.roles,
  });

  final String label;
  final IconData icon;
  final PaletteAction destination;
  final List<String> roles;
}

class _PaletteResultTile extends StatelessWidget {
  const _PaletteResultTile({
    required this.entry,
    required this.selected,
    required this.onTap,
  });

  final _PaletteEntry entry;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brandBg = dark ? AppColorsDark.brand050 : AppColors.brand050;
    final brandFg = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Material(
      color: selected ? brandBg : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Icon(
                entry.icon,
                size: 20,
                color: selected
                    ? brandFg
                    : (dark ? AppColorsDark.muted : AppColors.muted),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  entry.label,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected
                        ? brandFg
                        : (dark ? AppColorsDark.ink : AppColors.ink),
                  ),
                ),
              ),
              if (selected)
                Icon(Icons.arrow_forward_ios, size: 14, color: brandFg),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Public action type ──

enum PaletteDestination {
  dashboard,
  courses,
  learning,
  admissions,
  academic,
  announcements,
  discussions,
  fees,
  reports,
  certificates,
  marking,
  users,
  settings,
  backups,
  audit,
  security,
}

typedef PaletteAction = PaletteDestination;
