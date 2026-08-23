import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/models/auth_session.dart';
import 'announcements_page.dart';
import 'discussion_page.dart';
import 'inbox_page.dart';
import 'integrations_page.dart';
import 'notification_preferences_page.dart';

/// The Communication & Notifications panel — a tabbed container for the
/// six sub-features: Announcements, Inbox, Discussions, Preferences, and
/// Integrations.
///
/// Uses [IndexedStack] to preserve tab state, exactly like [AppShell].
class CommunicationPanel extends StatefulWidget {
  const CommunicationPanel({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<CommunicationPanel> createState() => _CommunicationPanelState();
}

class _CommunicationPanelState extends State<CommunicationPanel> {
  int _selectedIndex = 0;

  bool get _isAdmin => widget.user.isAdmin || widget.user.isSuperAdmin;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    final tabs = <_TabEntry>[
      _TabEntry(
        icon: Icons.campaign_outlined,
        activeIcon: Icons.campaign,
        label: 'Announcements',
        page: AnnouncementsPage(api: widget.api, user: widget.user),
      ),
      _TabEntry(
        icon: Icons.notifications_none_outlined,
        activeIcon: Icons.notifications,
        label: 'Inbox',
        page: InboxPage(api: widget.api),
      ),
      _TabEntry(
        icon: Icons.forum_outlined,
        activeIcon: Icons.forum,
        label: 'Discussion',
        page: DiscussionPage(api: widget.api, user: widget.user),
      ),
      _TabEntry(
        icon: Icons.tune_outlined,
        activeIcon: Icons.tune,
        label: 'Settings',
        page: NotificationPreferencesPage(api: widget.api),
      ),
      if (_isAdmin)
        _TabEntry(
          icon: Icons.integration_instructions_outlined,
          activeIcon: Icons.integration_instructions,
          label: 'Integrations',
          page: IntegrationsPage(api: widget.api),
        ),
    ];

    final clampedIndex = _selectedIndex.clamp(0, tabs.length - 1);
    if (clampedIndex != _selectedIndex) {
      _selectedIndex = clampedIndex;
    }

    return Column(
      children: [
        // Top tab bar
        Container(
          height: 48,
          decoration: BoxDecoration(
            color: dark ? AppColorsDark.surface : AppColors.surface,
            border: Border(
              bottom: BorderSide(
                color: dark ? AppColorsDark.line : AppColors.line,
              ),
            ),
          ),
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: [
              for (var i = 0; i < tabs.length; i++)
                _TabChip(
                  label: tabs[i].label,
                  icon: _selectedIndex == i
                      ? tabs[i].activeIcon
                      : tabs[i].icon,
                  selected: _selectedIndex == i,
                  onTap: () => setState(() => _selectedIndex = i),
                ),
            ],
          ),
        ),
        // Tab content
        Expanded(
          child: IndexedStack(
            index: _selectedIndex,
            children: tabs.map((t) => t.page).toList(),
          ),
        ),
      ],
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

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = selected
        ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
        : (dark ? AppColorsDark.muted : AppColors.muted);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        margin: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? (dark
                  ? AppColorsDark.brand600.withValues(alpha: 0.12)
                  : AppColors.brand050)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: fg),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
