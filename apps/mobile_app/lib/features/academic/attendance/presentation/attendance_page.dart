import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../cubit/attendance_cubit.dart';
import '../data/attendance_repository.dart';
import '../data/models/attendance_models.dart';

/// Attendance register — SRS §5.11, §13.6, UC-15.
///
/// Corresponds to the web's AttendancePage. Teachers take the register here,
/// marking exceptions (absent, late, excused) — everyone else is present.
class AttendancePage extends StatelessWidget {
  const AttendancePage({super.key, required this.api});

  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AttendanceCubit(
        repository: AttendanceRepository(api: api),
      )..loadSessions(),
      child: const _AttendanceView(),
    );
  }
}

class _AttendanceView extends StatelessWidget {
  const _AttendanceView();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Attendance'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocBuilder<AttendanceCubit, AttendanceState>(
        builder: (context, state) {
          if (state.status == AttendancePageStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state.status == AttendancePageStatus.failure) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error_outline,
                        size: 48, color: AppColors.error),
                    const SizedBox(height: 12),
                    Text(
                      'Could not load attendance',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      state.error?.message ?? 'Unknown error',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          if (state.sessions.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.event_busy,
                        size: 48,
                        color: dark ? AppColorsDark.muted : AppColors.muted),
                    const SizedBox(height: 12),
                    Text(
                      'No classes scheduled',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'No classes are scheduled in the next 30 days '
                      'for the subjects you teach.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }

          return Column(
            children: [
              // Session picker
              _SessionPicker(
                sessions: state.sessions,
                selectedId: state.selectedSessionId,
                dark: dark,
                onChanged: (id) =>
                    context.read<AttendanceCubit>().loadRegister(id),
              ),
              // Register
              if (state.register != null)
                Expanded(
                  child: _RegisterGrid(
                    state: state,
                    dark: dark,
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SessionPicker extends StatelessWidget {
  const _SessionPicker({
    required this.sessions,
    required this.selectedId,
    required this.dark,
    required this.onChanged,
  });

  final List<AttendanceSession> sessions;
  final String? selectedId;
  final bool dark;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          bottom: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
        ),
      ),
      child: DropdownButton<String>(
        value: selectedId,
        isExpanded: true,
        underline: const SizedBox.shrink(),
        items: sessions
            .map((s) => DropdownMenuItem(
                  value: s.id,
                  child: Text(
                    s.label,
                    style: const TextStyle(fontSize: 14),
                    overflow: TextOverflow.ellipsis,
                  ),
                ))
            .toList(),
        onChanged: (id) {
          if (id != null) onChanged(id);
        },
      ),
    );
  }
}

class _RegisterGrid extends StatelessWidget {
  const _RegisterGrid({required this.state, required this.dark});

  final AttendanceState state;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final register = state.register!;
    final students = register.students;
    final unmarked = state.unmarked;

    return Column(
      children: [
        // Progress header
        _RegisterHeader(
          register: register,
          unmarked: unmarked,
          dark: dark,
          onMarkAllPresent: () =>
              context.read<AttendanceCubit>().markAll('PRESENT'),
          onMarkAllAbsent: () =>
              context.read<AttendanceCubit>().markAll('ABSENT'),
        ),
        // Student list
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            itemCount: students.length,
            itemBuilder: (context, index) {
              final student = students[index];
              final currentStatus =
                  state.marks[student.studentId] ?? 'NOT_MARKED';
              return _StudentRow(
                student: student,
                currentStatus: currentStatus,
                dark: dark,
                onStatusChanged: (status) => context
                    .read<AttendanceCubit>()
                    .setMark(student.studentId, status),
              );
            },
          ),
        ),
        // Save bar
        _SaveBar(
          saving: state.saving,
          savedAt: state.savedAt,
          error: state.saveError,
          successMessage: state.successMessage,
          dark: dark,
          onSave: () => context.read<AttendanceCubit>().save(),
        ),
      ],
    );
  }
}

class _RegisterHeader extends StatelessWidget {
  const _RegisterHeader({
    required this.register,
    required this.unmarked,
    required this.dark,
    required this.onMarkAllPresent,
    required this.onMarkAllAbsent,
  });

  final Register register;
  final int unmarked;
  final bool dark;
  final VoidCallback onMarkAllPresent;
  final VoidCallback onMarkAllAbsent;

  @override
  Widget build(BuildContext context) {
    final session = register.session;
    final total = register.students.length;
    final marked = total - unmarked;
    final progress = total == 0 ? 0.0 : marked / total;

    return Container(
      padding: const EdgeInsets.all(14),
      margin: const EdgeInsets.fromLTRB(20, 8, 20, 0),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            session.title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            '${session.subjectName} · ${session.sectionCode}',
            style: TextStyle(
              fontSize: 12,
              color: dark ? AppColorsDark.muted : AppColors.muted,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          '$marked of $total marked',
                          style: const TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(width: 8),
                        if (unmarked == 0)
                          _PillSmall(text: 'All marked', ok: true, dark: dark)
                        else
                          _PillSmall(
                              text: '$unmarked to go', ok: false, dark: dark),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        value: progress,
                        minHeight: 4,
                        backgroundColor: (dark
                                ? AppColorsDark.line
                                : AppColors.line)
                            .withValues(alpha: 0.5),
                        valueColor: AlwaysStoppedAnimation<Color>(
                          dark ? AppColorsDark.brand600 : AppColors.brand600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _SmallButton(
                label: 'All present',
                onTap: onMarkAllPresent,
                dark: dark,
              ),
              const SizedBox(width: 8),
              _SmallButton(
                label: 'All absent',
                onTap: onMarkAllAbsent,
                dark: dark,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PillSmall extends StatelessWidget {
  const _PillSmall({required this.text, required this.ok, required this.dark});

  final String text;
  final bool ok;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final color = ok ? AppColors.ok : AppColors.warn;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: color),
      ),
    );
  }
}

class _SmallButton extends StatelessWidget {
  const _SmallButton({
    required this.label,
    required this.onTap,
    required this.dark,
  });

  final String label;
  final VoidCallback onTap;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: dark ? AppColorsDark.surface2 : AppColors.surface2,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: dark ? AppColorsDark.ink : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

class _StudentRow extends StatelessWidget {
  const _StudentRow({
    required this.student,
    required this.currentStatus,
    required this.dark,
    required this.onStatusChanged,
  });

  final RegisterStudent student;
  final String currentStatus;
  final bool dark;
  final ValueChanged<String> onStatusChanged;

  static const _statuses = [
    ('P', 'PRESENT'),
    ('A', 'ABSENT'),
    ('L', 'LATE'),
    ('E', 'EXCUSED'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(
          color: currentStatus == 'NOT_MARKED'
              ? AppColors.warn.withValues(alpha: 0.3)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
      ),
      child: Row(
        children: [
          // Roll + name
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${student.rollNo ?? "—"}. ${student.name}',
                  style: const TextStyle(fontSize: 13),
                ),
                Text(
                  student.registrationNo,
                  style: TextStyle(
                    fontSize: 11,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          // Status buttons
          for (final (label, status) in _statuses)
            GestureDetector(
              onTap: () => onStatusChanged(status),
              child: Container(
                width: 32,
                height: 32,
                margin: const EdgeInsets.only(left: 4),
                decoration: BoxDecoration(
                  color: currentStatus == status
                      ? _statusColor(status).withValues(alpha: 0.15)
                      : Colors.transparent,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(
                    color: currentStatus == status
                        ? _statusColor(status)
                        : (dark ? AppColorsDark.line : AppColors.line),
                  ),
                ),
                child: Center(
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: currentStatus == status
                          ? _statusColor(status)
                          : (dark ? AppColorsDark.muted : AppColors.muted),
                    ),
                  ),
                ),
              ),
            ),
          // Source
          Padding(
            padding: const EdgeInsets.only(left: 6),
            child: Text(
              student.markingSource == 'MANUAL' ? '—' : 'auto',
              style: TextStyle(
                fontSize: 10,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'PRESENT':
        return AppColors.ok;
      case 'ABSENT':
        return AppColors.error;
      case 'LATE':
        return AppColors.warn;
      case 'EXCUSED':
        return AppColors.brand600;
      default:
        return AppColors.muted;
    }
  }
}

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.saving,
    required this.savedAt,
    required this.error,
    required this.successMessage,
    required this.dark,
    required this.onSave,
  });

  final bool saving;
  final DateTime? savedAt;
  final String? error;
  final String? successMessage;
  final bool dark;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                error!,
                style: TextStyle(fontSize: 12, color: AppColors.error),
              ),
            ),
          if (successMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                successMessage!,
                style: TextStyle(fontSize: 12, color: AppColors.ok),
              ),
            ),
          Row(
            children: [
              if (savedAt != null)
                Expanded(
                  child: Text(
                    'Saved at ${TimeOfDay.fromDateTime(savedAt!).format(context)}',
                    style: TextStyle(
                      fontSize: 12,
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                  ),
                )
              else
                const Spacer(),
              GestureDetector(
                onTap: saving ? null : onSave,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Text(
                    saving ? 'Saving…' : 'Save register',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: dark ? AppColorsDark.ctaInk : AppColors.ctaInk,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
