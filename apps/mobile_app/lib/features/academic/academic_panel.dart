import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../auth/data/models/auth_session.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../admin/presentation/admin_panel.dart';
import '../enrolment/enrolment_page.dart';
import 'content/content_page.dart';
import 'sections/sections_page.dart';
import 'staffing/staffing_page.dart';
import 'structure/structure_page.dart';
import 'subjects/subjects_page.dart';
import 'timetable/timetable_page.dart';
import 'attendance/presentation/attendance_page.dart';
import '../teaching/marking/data/marking_repository.dart';
import '../teaching/marking/presentation/marking_queue_page.dart';
import '../teaching/rubrics/data/rubrics_repository.dart';
import '../teaching/rubrics/presentation/rubrics_page.dart';
import '../teaching/assignment_builder/data/assignment_builder_repository.dart';
import '../teaching/assignment_builder/presentation/assignment_builder_page.dart';

/// The academic management hub — the mobile equivalent of the web sidebar's
/// "Institute" block.
///
/// The same role gates as the web's navigation: institute configuration is
/// offered to staff, and teacher assignment to the office alone. The server
/// is what actually refuses (ARC-003); this list only keeps the interface
/// from offering what would be refused.
class AcademicPanel extends StatelessWidget {
  const AcademicPanel({super.key, required this.user, required this.api});

  final AuthUser user;
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    final entries = <_Entry>[
      _Entry(
        icon: Icons.account_tree_outlined,
        title: 'Academic structure',
        subtitle: 'Programmes, terms and batches — the shape of the place',
        builder: (context) => StructurePage(api: api, user: user),
      ),
      _Entry(
        icon: Icons.groups_outlined,
        title: 'Sections',
        subtitle: 'Section groups, their subjects and who teaches them',
        builder: (context) => SectionsPage(api: api, user: user),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.how_to_reg_outlined,
        title: 'Enrolment',
        subtitle: 'Rosters, transfers, suspension, withdrawal and bulk moves',
        builder: (context) => EnrolmentPage(api: api, user: user),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.menu_book_outlined,
        title: 'Subjects',
        subtitle: 'The catalogue every section offers from',
        builder: (context) => SubjectsPage(api: api, user: user),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.layers_outlined,
        title: 'Modules & lessons',
        subtitle: 'Course content — modules, lessons, publication',
        builder: (context) => ContentPage(api: api, user: user),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.event_outlined,
        title: 'Timetable',
        subtitle: "Your classes, and a term's generated schedule",
        builder: (context) => TimetablePage(api: api, user: user),
      ),
      _Entry(
        icon: Icons.how_to_reg_outlined,
        title: 'Attendance',
        subtitle: 'Take the register and mark student attendance',
        builder: (context) => AttendancePage(api: api),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.grading_outlined,
        title: 'Marking & Grading',
        subtitle: 'Review assignments, grade submissions and mark quizzes',
        builder: (context) => RepositoryProvider(
          create: (_) => MarkingRepository(api),
          child: const MarkingQueuePage(),
        ),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.rule_outlined,
        title: 'Rubrics',
        subtitle: 'Create and manage grading rubrics',
        builder: (context) => RepositoryProvider(
          create: (_) => RubricsRepository(api),
          child: const RubricsPage(),
        ),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.assignment_outlined,
        title: 'Assignment Builder',
        subtitle: 'Create and manage assignments for your sections',
        builder: (context) => RepositoryProvider(
          create: (_) => AssignmentBuilderRepository(api),
          child: const AssignmentBuilderPage(),
        ),
        staffOnly: true,
      ),
      _Entry(
        icon: Icons.badge_outlined,
        title: 'Teaching staff',
        subtitle: 'Assign teachers to subjects and sections',
        builder: (context) => StaffingPage(api: api),
        staffOnly: true,
        officeOnly: true,
      ),
      _Entry(
        icon: Icons.admin_panel_settings_outlined,
        title: 'Administration',
        subtitle: 'User management, settings, backups, audit and security logs',
        builder: (context) => AdminPanel(user: user, api: api),
        officeOnly: true,
      ),
    ];

    final visible = entries.where((e) => e.visibleFor(user)).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Academic'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              'Academic management',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Programmes, sections, subjects, content, timetables and the '
              'teachers who teach them.',
              style: TextStyle(
                fontSize: 12.5,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 14),
            for (final entry in visible)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _EntryTile(entry: entry),
              ),
          ],
        ),
      ),
    );
  }
}

class _Entry {
  const _Entry({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.builder,
    this.staffOnly = false,
    this.officeOnly = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final WidgetBuilder builder;
  final bool staffOnly;
  final bool officeOnly;

  /// The same whitelists the web sidebar keeps: staff for institute
  /// configuration, the office alone for teacher assignment (BR-ACC-04).
  bool visibleFor(AuthUser user) {
    if (officeOnly) return user.isAdmin || user.isSuperAdmin;
    if (staffOnly) return user.isAdmin || user.isSuperAdmin || user.isTeacher;
    return true;
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({required this.entry});

  final _Entry entry;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(builder: entry.builder),
            );
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Icon(entry.icon, size: 20, color: dark ? AppColorsDark.brand600 : AppColors.brand600),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.title,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        entry.subtitle,
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}