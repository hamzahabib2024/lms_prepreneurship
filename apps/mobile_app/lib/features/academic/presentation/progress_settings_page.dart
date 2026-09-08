import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../cubit/progress_settings_cubit.dart';

const _parts = [
  (key: 'video', label: 'Recordings watched', means: 'How much of the lectures they have played'),
  (key: 'assignment', label: 'Work handed in', means: 'Assignments submitted, marked or not'),
  (key: 'quiz', label: 'Quizzes sat', means: 'Quizzes attempted, however they scored'),
  (key: 'attendance', label: 'Attendance', means: 'Classes present or late, out of those held'),
];

const _thresholds = [
  (key: 'minProgressPercent', label: 'Progress needed', means: 'Of the four parts above, combined'),
  (key: 'minAttendancePercent', label: 'Attendance needed', means: 'Separately from the weighting'),
  (key: 'minAverageGradePercent', label: 'Average mark needed', means: 'Across released marks'),
];

class ProgressSettingsPage extends StatelessWidget {
  const ProgressSettingsPage({
    super.key,
    required this.api,
    required this.sectionSubjectId,
  });

  final ApiClient api;
  final String sectionSubjectId;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ProgressSettingsCubit(
        api: api,
        sectionSubjectId: sectionSubjectId,
      )..load(),
      child: const _ProgressSettingsView(),
    );
  }
}

class _ProgressSettingsView extends StatefulWidget {
  const _ProgressSettingsView();

  @override
  State<_ProgressSettingsView> createState() => _ProgressSettingsViewState();
}

class _ProgressSettingsViewState extends State<_ProgressSettingsView> {
  final _weightControllers = <String, TextEditingController>{};
  final _criteriaControllers = <String, TextEditingController>{};
  bool _open = false;

  @override
  void dispose() {
    for (final c in _weightControllers.values) {
      c.dispose();
    }
    for (final c in _criteriaControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _initControllers(ProgressSettingsData settings) {
    _weightControllers.putIfAbsent('video',
        () => TextEditingController(text: settings.weights.video.round().toString()));
    _weightControllers.putIfAbsent('assignment',
        () => TextEditingController(text: settings.weights.assignment.round().toString()));
    _weightControllers.putIfAbsent('quiz',
        () => TextEditingController(text: settings.weights.quiz.round().toString()));
    _weightControllers.putIfAbsent('attendance',
        () => TextEditingController(text: settings.weights.attendance.round().toString()));
    _criteriaControllers.putIfAbsent('minProgressPercent',
        () => TextEditingController(text: settings.criteria.minProgressPercent.round().toString()));
    _criteriaControllers.putIfAbsent('minAttendancePercent',
        () => TextEditingController(text: settings.criteria.minAttendancePercent.round().toString()));
    _criteriaControllers.putIfAbsent('minAverageGradePercent',
        () => TextEditingController(text: settings.criteria.minAverageGradePercent.round().toString()));
  }

  double get _total {
    double t = 0;
    for (final p in _parts) {
      t += double.tryParse(_weightControllers[p.key]?.text ?? '') ?? 0;
    }
    return t;
  }

  bool get _totals100 => (_total - 100).abs() < 0.01;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Progress settings'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: BlocConsumer<ProgressSettingsCubit, ProgressSettingsState>(
        listener: (context, state) {
          if (state.settings != null) _initControllers(state.settings!);
        },
        builder: (context, state) {
          if (state.loading) {
            return const SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: SkeletonCards(count: 3),
            );
          }

          if (state.error != null) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: AppAlert(
                title: 'Could not load settings',
                message: state.error!.message,
              ),
            );
          }

          final settings = state.settings;
          if (settings == null) return const SizedBox.shrink();

          return RefreshIndicator(
            onRefresh: () => context.read<ProgressSettingsCubit>().load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              children: [
                // Summary
                _buildSummary(settings),
                const SizedBox(height: 14),

                // Toggle button
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => setState(() => _open = !_open),
                    icon: Icon(_open ? Icons.expand_less : Icons.expand_more, size: 20),
                    label: Text(_open ? 'Hide settings' : 'Change settings'),
                  ),
                ),

                if (_open && settings.weights.ownedByThisClass) ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: state.saving
                          ? null
                          : () => _confirmFollowInstitute(context),
                      icon: const Icon(Icons.arrow_back, size: 18),
                      label: const Text('Follow the Institute instead'),
                    ),
                  ),
                ],

                if (_open) ...[
                  const SizedBox(height: 16),
                  _buildWeightsSection(context, state),
                  const SizedBox(height: 16),
                  _buildCriteriaSection(context, state),
                ],

                // Success note
                if (state.note != null) ...[
                  const SizedBox(height: 12),
                  AppAlert(title: 'Saved', message: state.note!),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSummary(ProgressSettingsData settings) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _parts
                .map((p) => '${p.label} ${_getValue(settings.weights, p.key).round()}%')
                .join(' \u00b7 '),
            style: TextStyle(
              fontSize: 13,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Complete at ${settings.criteria.minProgressPercent.round()}% progress, '
            '${settings.criteria.minAttendancePercent.round()}% attendance and '
            '${settings.criteria.minAverageGradePercent.round()}% average mark. '
            '${settings.weights.ownedByThisClass ? "Set for this batch." : "Following the Institute\u2019s settings."}',
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeightsSection(BuildContext context, ProgressSettingsState state) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final total = _total;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'The four parts',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: dark ? AppColorsDark.ink : AppColors.ink,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'They must add up to 100. Set one to 0 for a subject with no quizzes.',
          style: TextStyle(
            fontSize: 12,
            color: dark ? AppColorsDark.muted : AppColors.muted,
          ),
        ),
        const SizedBox(height: 10),
        for (final p in _parts)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  p.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    SizedBox(
                      width: 80,
                      child: TextField(
                        controller: _weightControllers[p.key],
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        style: TextStyle(
                          fontSize: 14,
                          color: dark ? AppColorsDark.ink : AppColors.ink,
                        ),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '%',
                      style: TextStyle(
                        fontSize: 14,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  p.means,
                  style: TextStyle(
                    fontSize: 11,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        Text(
          'They add up to ${total.round()}'
          '${_totals100 ? " \u2014 that is right." : ". They must add up to 100 before this can be saved."}',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: _totals100
                ? (dark ? AppColorsDark.ok : AppColors.ok)
                : (dark ? AppColorsDark.warn : AppColors.warn),
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: (state.saving || !_totals100)
                ? null
                : () => _save(context),
            child: Text(state.saving ? 'Saving\u2026' : 'Save'),
          ),
        ),
      ],
    );
  }

  Widget _buildCriteriaSection(BuildContext context, ProgressSettingsState state) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'What counts as complete',
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: dark ? AppColorsDark.ink : AppColors.ink,
          ),
        ),
        const SizedBox(height: 10),
        for (final t in _thresholds)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    SizedBox(
                      width: 80,
                      child: TextField(
                        controller: _criteriaControllers[t.key],
                        keyboardType: TextInputType.number,
                        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                        style: TextStyle(
                          fontSize: 14,
                          color: dark ? AppColorsDark.ink : AppColors.ink,
                        ),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '%',
                      style: TextStyle(
                        fontSize: 14,
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  t.means,
                  style: TextStyle(
                    fontSize: 11,
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        Text(
          'Changing this changes every student\u2019s figure on this batch at once. '
          'It does not change their marks, and it does not undo a completion you have already decided.',
          style: TextStyle(
            fontSize: 11,
            color: dark ? AppColorsDark.muted : AppColors.muted,
          ),
        ),
      ],
    );
  }

  double _getValue(ProgressWeights weights, String key) {
    switch (key) {
      case 'video':
        return weights.video;
      case 'assignment':
        return weights.assignment;
      case 'quiz':
        return weights.quiz;
      case 'attendance':
        return weights.attendance;
      default:
        return 0;
    }
  }

  Future<void> _save(BuildContext context) async {
    final cubit = context.read<ProgressSettingsCubit>();
    await cubit.save(
      weights: ProgressWeights(
        video: double.tryParse(_weightControllers['video']?.text ?? '') ?? 0,
        assignment: double.tryParse(_weightControllers['assignment']?.text ?? '') ?? 0,
        quiz: double.tryParse(_weightControllers['quiz']?.text ?? '') ?? 0,
        attendance: double.tryParse(_weightControllers['attendance']?.text ?? '') ?? 0,
      ),
      criteria: ProgressCriteria(
        minProgressPercent: double.tryParse(_criteriaControllers['minProgressPercent']?.text ?? '') ?? 0,
        minAttendancePercent: double.tryParse(_criteriaControllers['minAttendancePercent']?.text ?? '') ?? 0,
        minAverageGradePercent: double.tryParse(_criteriaControllers['minAverageGradePercent']?.text ?? '') ?? 0,
      ),
    );
  }

  Future<void> _confirmFollowInstitute(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Follow the Institute?'),
        content: const Text(
          'Go back to the Institute\u2019s settings?\n\n'
          'This class stops having its own weighting. '
          'Every student\u2019s progress figure is recalculated the moment you do it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      context.read<ProgressSettingsCubit>().followInstitute();
    }
  }
}
