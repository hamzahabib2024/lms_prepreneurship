import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../cubit/course_admin_cubit.dart';
import '../data/course_admin_repository.dart';
import '../data/models/course_admin_models.dart';
import 'course_edit_page.dart';
import 'subject_edit_page.dart';
import 'batch_edit_page.dart';

class CourseAdminPage extends StatefulWidget {
  const CourseAdminPage({super.key, required this.api});
  final ApiClient api;

  @override
  State<CourseAdminPage> createState() => _CourseAdminPageState();
}

class _CourseAdminPageState extends State<CourseAdminPage> {
  late final CourseAdminCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = CourseAdminCubit(CourseAdminRepository(widget.api))..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Courses & Fees'),
          actions: [
            IconButton(
              icon: const Icon(Icons.add),
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => CourseEditPage(api: widget.api),
                ),
              ),
            ),
          ],
        ),
        body: BlocBuilder<CourseAdminCubit, CourseAdminState>(
          builder: (context, state) {
            if (state.loading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state.error != null) {
              return Center(child: Text(state.error!));
            }

            return RefreshIndicator(
              onRefresh: () => _cubit.load(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Courses panel
                  Text(
                    'Courses',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (state.programmes.isEmpty)
                    _EmptyCard(
                      message: 'No courses yet. Tap + to create one.',
                      dark: dark,
                    )
                  else
                    ...state.programmes.map((p) => _ProgrammeCard(
                          programme: p,
                          dark: dark,
                          onEdit: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => CourseEditPage(
                                api: widget.api,
                                programmeId: p.id,
                              ),
                            ),
                          ),
                          onAddBatch: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => BatchEditPage(
                                api: widget.api,
                                programmeId: p.id,
                              ),
                            ),
                          ),
                        )),

                  const SizedBox(height: 32),

                  // Subjects panel
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Subjects',
                          style: TextStyle(
                            color: dark ? AppColorsDark.ink : AppColors.ink,
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add),
                        onPressed: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => SubjectEditPage(api: widget.api),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (state.subjects.isEmpty)
                    _EmptyCard(
                      message: 'No subjects yet. Tap + to create one.',
                      dark: dark,
                    )
                  else
                    ...state.subjects.map((s) => _SubjectCard(
                          subject: s,
                          dark: dark,
                          onTap: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => SubjectEditPage(
                                api: widget.api,
                                subjectId: s.id,
                              ),
                            ),
                          ),
                        )),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Empty card ──

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message, required this.dark});
  final String message;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Center(
        child: Text(
          message,
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
          ),
        ),
      ),
    );
  }
}

// ── Programme card ──

class _ProgrammeCard extends StatelessWidget {
  const _ProgrammeCard({
    required this.programme,
    required this.dark,
    required this.onEdit,
    required this.onAddBatch,
  });

  final Programme programme;
  final bool dark;
  final VoidCallback onEdit;
  final VoidCallback onAddBatch;

  @override
  Widget build(BuildContext context) {
    final totals = programme.totals;
    final fee = programme.fee;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: dark ? AppColorsDark.surface : Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              programme.name,
                              style: TextStyle(
                                color: dark ? AppColorsDark.ink : AppColors.ink,
                                fontWeight: FontWeight.bold,
                                fontSize: 16,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: programme.isActive
                                  ? AppColors.ok.withValues(alpha: 0.1)
                                  : AppColors.muted.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              programme.isActive ? 'Active' : 'Inactive',
                              style: TextStyle(
                                color: programme.isActive
                                    ? AppColors.ok
                                    : AppColors.muted,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        programme.code,
                        style: TextStyle(
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            if (programme.description != null &&
                programme.description!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                programme.description!,
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 13,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],

            // Subjects
            if (programme.subjects.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: programme.subjects.map((s) => Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: dark
                            ? AppColorsDark.brand050
                            : AppColors.brand050,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        s.name,
                        style: TextStyle(
                          color: dark
                              ? AppColorsDark.brand600
                              : AppColors.brand600,
                          fontSize: 11,
                        ),
                      ),
                    )).toList(),
              ),
            ],

            // Totals row
            if (totals != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  _StatChip(
                    label: '${totals.batches} batches',
                    dark: dark,
                  ),
                  const SizedBox(width: 8),
                  _StatChip(
                    label: '${totals.enrolled}/${totals.seats} seats',
                    dark: dark,
                  ),
                  if (fee != null) ...[
                    const SizedBox(width: 8),
                    _StatChip(
                      label: fee.published ? 'Fee: Published' : 'Fee: Draft',
                      color: fee.published ? AppColors.ok : AppColors.warn,
                      dark: dark,
                    ),
                  ],
                ],
              ),
            ],

            // Batches list
            if (programme.batches.isNotEmpty) ...[
              const SizedBox(height: 8),
              ...programme.batches.map((b) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        Icon(Icons.circle, size: 6, color: AppColors.muted),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            b.name,
                            style: TextStyle(
                              color: dark ? AppColorsDark.ink : AppColors.ink,
                              fontSize: 12,
                            ),
                          ),
                        ),
                        Text(
                          '${b.enrolledCount}/${b.capacity}',
                          style: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  )),
            ],

            // Actions
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(
                  onPressed: onAddBatch,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add batch'),
                ),
                const SizedBox(width: 8),
                TextButton.icon(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit, size: 16),
                  label: const Text('Edit'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Stat chip ──

class _StatChip extends StatelessWidget {
  const _StatChip({required this.label, this.color, required this.dark});
  final String label;
  final Color? color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: (color ?? (dark ? AppColorsDark.muted : AppColors.muted))
            .withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color ?? (dark ? AppColorsDark.muted : AppColors.muted),
          fontSize: 11,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

// ── Subject card ──

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({
    required this.subject,
    required this.dark,
    required this.onTap,
  });

  final Subject subject;
  final bool dark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: dark ? AppColorsDark.surface : Colors.white,
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: dark ? AppColorsDark.brand050 : AppColors.brand050,
          child: Text(
            subject.code.substring(0, 1),
            style: TextStyle(
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        title: Text(
          subject.name,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Text(
          subject.code,
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 12,
          ),
        ),
        trailing: Icon(
          Icons.chevron_right,
          color: dark ? AppColorsDark.muted : AppColors.muted,
        ),
        onTap: onTap,
      ),
    );
  }
}
