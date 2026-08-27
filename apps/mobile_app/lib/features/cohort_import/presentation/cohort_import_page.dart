import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/app_theme.dart';
import '../cubit/cohort_import_cubit.dart';
import '../data/models/cohort_import_models.dart';

class CohortImportPage extends StatefulWidget {
  const CohortImportPage({super.key});

  @override
  State<CohortImportPage> createState() => _CohortImportPageState();
}

class _CohortImportPageState extends State<CohortImportPage> {
  late final CohortImportCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = context.read<CohortImportCubit>()..init();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cohort Import'),
        actions: [
          BlocBuilder<CohortImportCubit, CohortImportState>(
            buildWhen: (p, c) => c.result != null,
            builder: (context, state) {
              if (state.result == null) return const SizedBox.shrink();
              return TextButton(
                onPressed: () => _cubit.reset(),
                child: const Text('Import another'),
              );
            },
          ),
        ],
      ),
      body: BlocConsumer<CohortImportCubit, CohortImportState>(
        listener: (context, state) {
          if (state.error != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.error!)),
            );
            _cubit.clearError();
          }
        },
        builder: (context, state) {
          return           SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ── How it works ──
                _HowItWorksBanner(dark: dark),
                const SizedBox(height: 20),

                // ── Step indicator ──
                _StepIndicator(current: state.step, dark: dark),
                const SizedBox(height: 20),

                if (state.result != null) ...[
                  _ResultPanel(result: state.result!, dark: dark),
                ] else ...[
                  // ── Section picker ──
                  _SectionPicker(
                    sections: state.sections,
                    selectedId: state.sectionId,
                    dark: dark,
                    onChanged: (id) => _cubit.setSectionId(id),
                  ),
                  const SizedBox(height: 16),

                  if (state.step == CohortImportStep.pickFile) ...[
                    _FileUpload(
                      fileName: state.fileName,
                      csv: state.csv,
                      dark: dark,
                      onFileLoaded: (csv, name) => _cubit.setCsv(csv, name),
                    ),
                    const SizedBox(height: 20),
                    _CheckButton(
                      enabled: state.canPreview,
                      loading: state.loading,
                      onPressed: () => _cubit.runPreview(),
                    ),
                  ],

                  if (state.step == CohortImportStep.preview &&
                      state.preview != null) ...[
                    _PreviewPanel(
                      preview: state.preview!,
                      note: state.note,
                      consent: state.consent,
                      capacityOverride: state.capacityOverride,
                      canCommit: state.canCommit,
                      loading: state.loading,
                      dark: dark,
                      onNoteChanged: (v) => _cubit.setNote(v),
                      onConsentChanged: (v) => _cubit.setConsent(v),
                      onCapacityOverrideChanged: (v) =>
                          _cubit.setCapacityOverride(v),
                      onCommit: () => _cubit.runCommit(),
                      onBack: () => _cubit.setCsv(state.csv, state.fileName),
                    ),
                  ],
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

// ── How it works banner ──

class _HowItWorksBanner extends StatelessWidget {
  const _HowItWorksBanner({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'How it works',
            style: TextStyle(
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '1. Download the CSV template and fill in student details\n'
            '2. Select a section and upload the file\n'
            '3. Review the preview before loading\n'
            '4. Confirm and load the cohort',
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 12,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Step indicator ──

class _StepIndicator extends StatelessWidget {
  const _StepIndicator({required this.current, required this.dark});
  final CohortImportStep current;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final steps = [
      (CohortImportStep.pickFile, 'Upload'),
      (CohortImportStep.preview, 'Preview'),
      (CohortImportStep.result, 'Result'),
    ];

    return Row(
      children: steps.asMap().entries.map((entry) {
        final i = entry.key;
        final (step, label) = entry.value;
        final isActive = step == current;
        final isPast = steps.indexOf(steps.firstWhere((s) => s.$1 == current)) > i;
        final color = isActive
            ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
            : isPast
                ? AppColors.ok
                : (dark ? AppColorsDark.muted : AppColors.muted);

        return Expanded(
          child: Row(
            children: [
              if (i > 0)
                Expanded(
                  child: Container(
                    height: 2,
                    color: isPast ? AppColors.ok : (dark ? AppColorsDark.line : AppColors.line),
                  ),
                ),
              if (i > 0) const SizedBox(width: 4),
              CircleAvatar(
                radius: 10,
                backgroundColor: color,
                child: isPast
                    ? const Icon(Icons.check, size: 12, color: Colors.white)
                    : Text(
                        '${i + 1}',
                        style: const TextStyle(color: Colors.white, fontSize: 10),
                      ),
              ),
              const SizedBox(width: 4),
              if (i < steps.length - 1)
                Expanded(
                  child: Container(
                    height: 2,
                    color: isPast ? AppColors.ok : (dark ? AppColorsDark.line : AppColors.line),
                  ),
                ),
              if (i < steps.length - 1) const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 11,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

// ── Section picker ──

class _SectionPicker extends StatelessWidget {
  const _SectionPicker({
    required this.sections,
    required this.selectedId,
    required this.dark,
    required this.onChanged,
  });

  final List<CohortSection> sections;
  final String selectedId;
  final bool dark;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Section',
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: selectedId.isEmpty ? null : selectedId,
          decoration: InputDecoration(
            hintText: 'Select section',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 12,
            ),
          ),
          items: sections
              .map((s) => DropdownMenuItem(
                    value: s.id,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(s.name, style: const TextStyle(fontSize: 14)),
                        if (s.genderRestriction != null ||
                            s.capacity != null)
                          Text(
                            [
                              if (s.genderRestriction != null)
                                s.genderRestriction!,
                              if (s.capacity != null)
                                '${s.enrolledCount ?? 0} of ${s.capacity} places',
                            ].join(' · '),
                            style: TextStyle(
                              fontSize: 11,
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ))
              .toList(),
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ],
    );
  }
}

// ── File upload ──

class _FileUpload extends StatelessWidget {
  const _FileUpload({
    required this.fileName,
    required this.csv,
    required this.dark,
    required this.onFileLoaded,
  });

  final String fileName;
  final String csv;
  final bool dark;
  final void Function(String csv, String fileName) onFileLoaded;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'CSV File',
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 8),
        InkWell(
          onTap: () async {
            final files = await FilePicker.pickFiles(
              type: FileType.custom,
              allowedExtensions: ['csv'],
            );
            if (files.isNotEmpty) {
              final file = files.first;
              final bytes = await file.readAsBytes();
              onFileLoaded(utf8.decode(bytes), file.name);
            }
          },
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: dark ? AppColorsDark.surface : AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.sm),
              border: Border.all(
                color: dark ? AppColorsDark.line : AppColors.line,
              ),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.upload_file,
                  size: 32,
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
                const SizedBox(height: 8),
                Text(
                  fileName.isEmpty
                      ? 'Tap to select a CSV file'
                      : fileName,
                  style: TextStyle(
                    color: fileName.isEmpty
                        ? (dark ? AppColorsDark.muted : AppColors.muted)
                        : (dark ? AppColorsDark.ink : AppColors.ink),
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (csv.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${csv.split('\n').length} rows',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                      fontSize: 12,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Required columns: fullName, email, gender, phone, dateOfBirth, nationalId',
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 11,
          ),
        ),
      ],
    );
  }
}

// ── Check button ──

class _CheckButton extends StatelessWidget {
  const _CheckButton({
    required this.enabled,
    required this.loading,
    required this.onPressed,
  });

  final bool enabled;
  final bool loading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: enabled ? onPressed : null,
        child: loading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : const Text('Check the file'),
      ),
    );
  }
}

// ── Preview panel ──

class _PreviewPanel extends StatelessWidget {
  const _PreviewPanel({
    required this.preview,
    required this.note,
    required this.consent,
    required this.capacityOverride,
    required this.canCommit,
    required this.loading,
    required this.dark,
    required this.onNoteChanged,
    required this.onConsentChanged,
    required this.onCapacityOverrideChanged,
    required this.onCommit,
    required this.onBack,
  });

  final ImportPreview preview;
  final String note;
  final bool consent;
  final bool capacityOverride;
  final bool canCommit;
  final bool loading;
  final bool dark;
  final ValueChanged<String> onNoteChanged;
  final ValueChanged<bool> onConsentChanged;
  final ValueChanged<bool> onCapacityOverrideChanged;
  final VoidCallback onCommit;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Summary message
        _PreviewSummary(preview: preview, dark: dark),
        const SizedBox(height: 12),

        // File problem
        if (preview.fileProblem != null)
          _FileProblemBanner(problem: preview.fileProblem!, dark: dark),

        // Unknown columns
        if (preview.unknownColumns.isNotEmpty)
          _WarningBanner(
            title: 'Unknown columns (will be ignored):',
            items: preview.unknownColumns,
            dark: dark,
          ),

        // Returning students
        if (preview.rows.any((r) => r.returningWith != null))
          _ReturningBanner(rows: preview.rows, dark: dark),

        // Gender blocked
        if (preview.rows.any((r) => r.blocked != null))
          _BlockedBanner(rows: preview.rows, dark: dark),

        // Row problems
        if (preview.rowProblems.isNotEmpty)
          _RowProblemsBanner(problems: preview.rowProblems, dark: dark),

        if (preview.capacityWarning != null)
          _WarningBanner(
            title: 'Capacity warning',
            items: [preview.capacityWarning!],
            dark: dark,
            color: AppColors.warn,
          ),

        // Commit form
        if (preview.fileProblem == null &&
            (preview.wouldLoad + preview.wouldRejoin) > 0) ...[
          const SizedBox(height: 16),
          _CommitForm(
            note: note,
            consent: consent,
            capacityOverride: capacityOverride,
            canCommit: canCommit,
            loading: loading,
            dark: dark,
            onNoteChanged: onNoteChanged,
            onConsentChanged: onConsentChanged,
            onCapacityOverrideChanged: onCapacityOverrideChanged,
            onCommit: onCommit,
            onBack: onBack,
            wouldLoad: preview.wouldLoad,
            wouldRejoin: preview.wouldRejoin,
          ),
        ],

        if (preview.fileProblem != null) ...[
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: onBack,
              child: const Text('Back to file'),
            ),
          ),
        ],
      ],
    );
  }
}

// ── Preview summary ──

class _PreviewSummary extends StatelessWidget {
  const _PreviewSummary({required this.preview, required this.dark});
  final ImportPreview preview;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    if (preview.fileProblem != null) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.errorBg,
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Text(
          preview.fileProblem!.message,
          style: const TextStyle(
            color: AppColors.error,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }

    final total = preview.wouldLoad + preview.wouldRejoin;
    final skipped = preview.rowProblems.length;
    final msg = preview.message.isNotEmpty
        ? preview.message
        : '$total ready to load.'
            '${skipped > 0 ? " $skipped rows will be SKIPPED." : ""}';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          Icon(
            Icons.info_outline,
            size: 18,
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              msg,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── File problem banner ──

class _FileProblemBanner extends StatelessWidget {
  const _FileProblemBanner({required this.problem, required this.dark});
  final FileProblem problem;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorBg,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '${problem.code}: ${problem.message}',
              style: const TextStyle(color: AppColors.error, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Warning banner ──

class _WarningBanner extends StatelessWidget {
  const _WarningBanner({
    required this.title,
    required this.items,
    required this.dark,
    this.color = AppColors.warn,
  });

  final String title;
  final List<String> items;
  final bool dark;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          ...items.map((item) => Text(
                '• $item',
                style: TextStyle(color: color, fontSize: 12),
              )),
        ],
      ),
    );
  }
}

// ── Returning students banner ──

class _ReturningBanner extends StatelessWidget {
  const _ReturningBanner({required this.rows, required this.dark});
  final List<PreviewRow> rows;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final returning = rows.where((r) => r.returningWith != null).toList();
    if (returning.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Returning students (${returning.length})',
            style: const TextStyle(
              color: AppColors.brand600,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          ...returning.map((r) => Text(
                '${r.fullName} — ${r.returningWith}',
                style: const TextStyle(
                  color: AppColors.brand600,
                  fontSize: 12,
                ),
              )),
        ],
      ),
    );
  }
}

// ── Blocked students banner ──

class _BlockedBanner extends StatelessWidget {
  const _BlockedBanner({required this.rows, required this.dark});
  final List<PreviewRow> rows;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final blocked = rows.where((r) => r.blocked != null).toList();
    if (blocked.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorBg,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Gender blocked (${blocked.length})',
            style: const TextStyle(
              color: AppColors.error,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          ...blocked.map((r) => Text(
                '${r.fullName} — ${r.blocked}',
                style: const TextStyle(
                  color: AppColors.error,
                  fontSize: 12,
                ),
              )),
        ],
      ),
    );
  }
}

// ── Row problems banner ──

class _RowProblemsBanner extends StatelessWidget {
  const _RowProblemsBanner({
    required this.problems,
    required this.dark,
  });

  final List<RowProblem> problems;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    // Group by line
    final grouped = <int, List<RowProblem>>{};
    for (final p in problems) {
      grouped.putIfAbsent(p.line, () => []).add(p);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.errorBg,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Row problems (${problems.length})',
            style: const TextStyle(
              color: AppColors.error,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          ...grouped.entries.map((entry) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Row ${entry.key}',
                    style: const TextStyle(
                      color: AppColors.error,
                      fontWeight: FontWeight.w600,
                      fontSize: 11,
                    ),
                  ),
                  ...entry.value.map((p) => Text(
                        '${p.field}: ${p.message}',
                        style: const TextStyle(
                          color: AppColors.error,
                          fontSize: 11,
                        ),
                      )),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}

// ── Commit form ──

class _CommitForm extends StatefulWidget {
  const _CommitForm({
    required this.note,
    required this.consent,
    required this.capacityOverride,
    required this.canCommit,
    required this.loading,
    required this.dark,
    required this.onNoteChanged,
    required this.onConsentChanged,
    required this.onCapacityOverrideChanged,
    required this.onCommit,
    required this.onBack,
    required this.wouldLoad,
    required this.wouldRejoin,
  });

  final String note;
  final bool consent;
  final bool capacityOverride;
  final bool canCommit;
  final bool loading;
  final bool dark;
  final ValueChanged<String> onNoteChanged;
  final ValueChanged<bool> onConsentChanged;
  final ValueChanged<bool> onCapacityOverrideChanged;
  final VoidCallback onCommit;
  final VoidCallback onBack;
  final int wouldLoad;
  final int wouldRejoin;

  @override
  State<_CommitForm> createState() => _CommitFormState();
}

class _CommitFormState extends State<_CommitForm> {
  late final TextEditingController _noteController;

  @override
  void initState() {
    super.initState();
    _noteController = TextEditingController(text: widget.note);
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final total = widget.wouldLoad + widget.wouldRejoin;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Confirm import',
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 12),

          // Consent checkbox
          Row(
            children: [
              Expanded(
                child: Checkbox(
                  value: widget.consent,
                  onChanged: (v) => widget.onConsentChanged(v ?? false),
                ),
              ),
              Expanded(
                child: Text(
                  'I confirm these students were given the Institute\'s data-collection notice',
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Note
          TextField(
            controller: _noteController,
            onChanged: widget.onNoteChanged,
            maxLines: 2,
            decoration: InputDecoration(
              hintText: 'Why this cohort is being imported (min 10 chars)',
              counterText: '${_noteController.text.length}/500',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Commit button
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: widget.canCommit ? widget.onCommit : null,
              child: widget.loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text('Load $total students'),
            ),
          ),

          // Back link
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: widget.onBack,
              child: const Text('Back to file'),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Result panel ──

class _ResultPanel extends StatelessWidget {
  const _ResultPanel({required this.result, required this.dark});
  final ImportResult result;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final skipped = result.outcomes.where((o) => o.status == 'SKIPPED').toList();
    final loaded = result.outcomes.where((o) => o.status == 'LOADED').toList();
    final rejoined = result.outcomes.where((o) => o.status == 'REJOINED').toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Summary
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: dark ? AppColorsDark.surface : AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                result.sectionName,
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                result.message.isNotEmpty
                    ? result.message
                    : '${result.loaded} loaded, ${result.rejoined} rejoined, ${result.skipped} skipped',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Skipped first
        if (skipped.isNotEmpty) ...[
          _ResultSection(
            title: 'Skipped (${skipped.length})',
            color: AppColors.error,
            items: skipped,
            dark: dark,
          ),
          const SizedBox(height: 12),
        ],

        // Loaded
        if (loaded.isNotEmpty) ...[
          _ResultSection(
            title: 'New students loaded (${loaded.length})',
            color: AppColors.ok,
            items: loaded,
            dark: dark,
            showPassword: true,
          ),
          const SizedBox(height: 12),
        ],

        // Rejoined
        if (rejoined.isNotEmpty) ...[
          _ResultSection(
            title: 'Rejoining students (${rejoined.length})',
            color: AppColors.brand600,
            items: rejoined,
            dark: dark,
          ),
          const SizedBox(height: 12),
        ],

        // Email summary
        if (result.emailed > 0 || result.notEmailed > 0)
          _EmailSummary(
            emailed: result.emailed,
            notEmailed: result.notEmailed,
            dark: dark,
          ),
      ],
    );
  }
}

// ── Result section ──

class _ResultSection extends StatelessWidget {
  const _ResultSection({
    required this.title,
    required this.color,
    required this.items,
    required this.dark,
    this.showPassword = false,
  });

  final String title;
  final Color color;
  final List<ImportOutcome> items;
  final bool dark;
  final bool showPassword;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 8),
          ...items.map((o) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${o.fullName} (${o.email})',
                            style: TextStyle(
                              color: dark ? AppColorsDark.ink : AppColors.ink,
                              fontSize: 12,
                            ),
                          ),
                        ),
                        if (o.registrationNo != null)
                          Text(
                            'Reg: ${o.registrationNo}',
                            style: TextStyle(
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                              fontSize: 11,
                            ),
                          ),
                      ],
                    ),
                    if (o.reason != null)
                      Text(
                        'Reason: ${o.reason}',
                        style: const TextStyle(
                          color: AppColors.error,
                          fontSize: 11,
                        ),
                      ),
                    if (showPassword && o.temporaryPassword != null) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: dark
                                  ? AppColorsDark.surface2
                                  : AppColors.surface2,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              'Pass: ${o.temporaryPassword}',
                              style: TextStyle(
                                color: dark
                                    ? AppColorsDark.ink
                                    : AppColors.ink,
                                fontSize: 11,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            icon: const Icon(Icons.copy, size: 14),
                            onPressed: () {
                              Clipboard.setData(
                                ClipboardData(
                                  text: '${o.fullName}\t${o.email}\t'
                                      '${o.registrationNo ?? ''}\t'
                                      '${o.rollNo ?? ''}\t'
                                      '${o.temporaryPassword}',
                                ),
                              );
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Copied to clipboard'),
                                ),
                              );
                            },
                          ),
                          if (o.emailSent == true)
                            const Icon(Icons.email, size: 14, color: AppColors.ok),
                          if (o.emailSent == false)
                            const Icon(Icons.email_outlined, size: 14, color: AppColors.warn),
                        ],
                      ),
                    ],
                  ],
                ),
              )),
        ],
      ),
    );
  }
}

// ── Email summary ──

class _EmailSummary extends StatelessWidget {
  const _EmailSummary({
    required this.emailed,
    required this.notEmailed,
    required this.dark,
  });

  final int emailed;
  final int notEmailed;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Row(
        children: [
          Icon(
            notEmailed > 0 ? Icons.warning_amber : Icons.check_circle,
            color: notEmailed > 0 ? AppColors.warn : AppColors.ok,
            size: 18,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              notEmailed > 0
                  ? '$emailed emailed, $notEmailed failed — relay passwords by hand'
                  : 'Every account was emailed to the student.',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
