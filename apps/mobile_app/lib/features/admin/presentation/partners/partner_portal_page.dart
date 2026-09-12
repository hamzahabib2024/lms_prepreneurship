import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/partner_portal_cubit.dart';
import '../../data/partner_portal_repository.dart';
import 'partner_invoices_page.dart';

class PartnerPortalPage extends StatelessWidget {
  const PartnerPortalPage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PartnerPortalCubit(
        repository: PartnerPortalRepository(api: api),
      )..load(),
      child: _PartnerPortalView(api: api),
    );
  }
}

class _PartnerPortalView extends StatelessWidget {
  const _PartnerPortalView({required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner portal'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          IconButton(
            tooltip: 'Invoices',
            icon: const Icon(Icons.receipt_long_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => PartnerInvoicesPage(api: api),
              ),
            ),
          ),
        ],
      ),
      body: BlocBuilder<PartnerPortalCubit, PartnerPortalState>(
        builder: (context, state) {
          if (state.loading) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 4),
            );
          }

          if (state.error != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  AppAlert(
                    title: 'Could not load partner data',
                    message: state.error!.message,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: () => context.read<PartnerPortalCubit>().load(),
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('Try again'),
                  ),
                ],
              ),
            );
          }

          final me = state.me;
          if (me == null) return const SizedBox.shrink();

          return Column(
            children: [
              _PartnerHeader(me: me),
              if (state.seesInvoices)
                _TabBar(
                  selectedTab: state.selectedTab,
                  onTabChanged: (tab) =>
                      context.read<PartnerPortalCubit>().setTab(tab),
                ),
              Expanded(
                child: state.selectedTab == 'students'
                    ? state.selectedStudentId != null
                        ? _StudentDetail()
                        : _StudentList()
                    : _InvoiceList(),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PartnerHeader extends StatelessWidget {
  const _PartnerHeader({required this.me});

  final PartnerMe me;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            me.name,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '${me.studentCount == 0 ? 'No students enrolled yet' : '${me.studentCount} student${me.studentCount == 1 ? '' : 's'} studying with us'}'
            ' · ${me.billingMode == 'PARTNER_PAYS' ? 'We invoice your institute' : 'Students pay us directly'}',
            style: TextStyle(fontSize: 13, color: muted),
          ),
        ],
      ),
    );
  }
}

class _TabBar extends StatelessWidget {
  const _TabBar({
    required this.selectedTab,
    required this.onTabChanged,
  });

  final String selectedTab;
  final ValueChanged<String> onTabChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
        ),
      ),
      child: Row(
        children: [
          _Tab(
            label: 'Students',
            selected: selectedTab == 'students',
            onTap: () => onTabChanged('students'),
          ),
          _Tab(
            label: 'Invoices',
            selected: selectedTab == 'invoices',
            onTap: () => onTabChanged('invoices'),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: selected ? brand : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              color: selected ? brand : muted,
            ),
          ),
        ),
      ),
    );
  }
}

class _StudentList extends StatefulWidget {
  const _StudentList();

  @override
  State<_StudentList> createState() => _StudentListState();
}

class _StudentListState extends State<_StudentList> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    context.read<PartnerPortalCubit>().loadStudents();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<PartnerPortalCubit, PartnerPortalState>(
      builder: (context, state) {
        if (state.loadingStudents) {
          return const SingleChildScrollView(
            padding: EdgeInsets.all(20),
            child: SkeletonCards(count: 3),
          );
        }

        if (state.studentsError != null) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: AppAlert(
              title: 'Could not load students',
              message: state.studentsError!.message,
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () => context.read<PartnerPortalCubit>().loadStudents(
                query: _searchController.text,
              ),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            children: [
              TextField(
                controller: _searchController,
                decoration: const InputDecoration(
                  labelText: 'Find a student',
                  hintText: 'By name or registration number',
                  prefixIcon: Icon(Icons.search, size: 20),
                ),
                onChanged: (v) {
                  if (v.trim().isEmpty) {
                    context.read<PartnerPortalCubit>().loadStudents();
                  }
                },
                onSubmitted: (v) {
                  context.read<PartnerPortalCubit>().loadStudents(query: v);
                },
              ),
              const SizedBox(height: 12),
              if (state.students.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 40),
                  child: Column(
                    children: [
                      Icon(Icons.people_outline,
                          size: 48,
                          color: Theme.of(context).colorScheme.onSurfaceVariant),
                      const SizedBox(height: 16),
                      Text(
                        _searchController.text.isNotEmpty
                            ? 'Nobody matches that'
                            : 'No students yet',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _searchController.text.isNotEmpty
                            ? 'Try part of a name, or the registration number.'
                            : 'Students will appear here once enrolled.',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontSize: 13.5,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                )
              else
                for (final s in state.students)
                  _StudentRow(student: s),
            ],
          ),
        );
      },
    );
  }
}

class _StudentRow extends StatelessWidget {
  const _StudentRow({required this.student});

  final PartnerStudentRow student;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: InkWell(
        onTap: () => context.read<PartnerPortalCubit>().selectStudent(student.id),
        borderRadius: BorderRadius.circular(AppRadius.sm),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  student.name.trim().isNotEmpty
                      ? student.name.trim()[0].toUpperCase()
                      : '?',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: muted,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      student.name,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${student.registrationNo}'
                      '${student.programme != null ? ' · ${student.programme}' : ''}'
                      '${student.section != null ? ' · ${student.section}' : ''}',
                      style: TextStyle(fontSize: 12, color: muted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _StudentDetail extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return BlocBuilder<PartnerPortalCubit, PartnerPortalState>(
      builder: (context, state) {
        if (state.loadingStudentDetail) {
          return const SingleChildScrollView(
            padding: EdgeInsets.all(20),
            child: SkeletonCards(count: 4),
          );
        }

        if (state.studentDetailError != null) {
          return Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                AppAlert(
                  title: 'Could not load student',
                  message: state.studentDetailError!.message,
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () =>
                      context.read<PartnerPortalCubit>().selectStudent(null),
                  child: const Text('Back to list'),
                ),
              ],
            ),
          );
        }

        final detail = state.studentDetail;
        if (detail == null) return const SizedBox.shrink();

        final dark = Theme.of(context).brightness == Brightness.dark;
        final muted = dark ? AppColorsDark.muted : AppColors.muted;

        return RefreshIndicator(
          onRefresh: () => context
              .read<PartnerPortalCubit>()
              .loadStudentDetail(state.selectedStudentId!),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            children: [
              TextButton.icon(
                onPressed: () =>
                    context.read<PartnerPortalCubit>().selectStudent(null),
                icon: const Icon(Icons.arrow_back, size: 18),
                label: const Text('All students'),
              ),
              const SizedBox(height: 8),
              Text(
                detail.student.name,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                '${detail.student.registrationNo}'
                '${detail.student.programme != null ? ' · ${detail.student.programme}' : ''}'
                '${detail.student.section != null ? ' · ${detail.student.section}' : ''}'
                '${detail.student.rollNo != null ? ' · Roll no. ${detail.student.rollNo}' : ''}',
                style: TextStyle(fontSize: 12.5, color: muted),
              ),
              const SizedBox(height: 20),
              Text('Subjects', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (detail.subjects.isEmpty)
                Text(
                  'No subject has been decided yet. Results appear here once released.',
                  style: TextStyle(fontSize: 13, color: muted),
                )
              else
                for (final s in detail.subjects)
                  ListRow(
                    title: s.subject,
                    subtitle: s.percent != null ? '${s.percent!.toStringAsFixed(1)}%' : null,
                    trailing: Pill(
                      text: s.decision,
                      kind: s.criteriaMet ? PillKind.ok : PillKind.neutral,
                    ),
                  ),
              const SizedBox(height: 20),
              Text('Attendance warnings',
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (detail.attendanceWarnings.isEmpty)
                Text(
                  'No attendance warnings. Nothing to be concerned about.',
                  style: TextStyle(fontSize: 13, color: muted),
                )
              else
                for (final w in detail.attendanceWarnings)
                  ListRow(
                    title: '${w.subject} — ${w.percentage.toStringAsFixed(0)}% attended',
                    subtitle:
                        'Against a requirement of ${w.threshold.toStringAsFixed(0)}%',
                    trailing: Pill(
                      text: w.severity == 'CRITICAL' ? 'Critical' : 'Warning',
                      kind: w.severity == 'CRITICAL'
                          ? PillKind.warn
                          : PillKind.neutral,
                    ),
                  ),
              const SizedBox(height: 20),
              Text('Certificates',
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (detail.certificates.isEmpty)
                Text(
                  'None issued yet.',
                  style: TextStyle(fontSize: 13, color: muted),
                )
              else
                for (final c in detail.certificates)
                  ListRow(
                    title: '${c.kind} — ${c.number}',
                    trailing: c.status != 'ISSUED'
                        ? Pill(text: c.status, kind: PillKind.warn)
                        : null,
                  ),
            ],
          ),
        );
      },
    );
  }
}

class _InvoiceList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.receipt_outlined, size: 48, color: muted),
            const SizedBox(height: 16),
            Text(
              'Invoices',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Invoices will appear here once raised by the institute.',
              style: TextStyle(color: muted, fontSize: 13.5),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
