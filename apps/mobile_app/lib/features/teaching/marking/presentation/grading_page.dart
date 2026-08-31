/// Grading page — SRS §13.6, FR-TCH-018.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/marking_cubit.dart';
import '../data/marking_repository.dart';
import '../data/models/marking_models.dart';
import 'submission_comments_widget.dart';

class GradingPage extends StatefulWidget {
  const GradingPage({
    super.key,
    required this.assignmentId,
    required this.title,
  });

  final String assignmentId;
  final String title;

  @override
  State<GradingPage> createState() => _GradingPageState();
}

class _GradingPageState extends State<GradingPage> {
  late final GradingCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = GradingCubit(context.read<MarkingRepository>())
      ..loadRoster(widget.assignmentId);
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
          title: Text('Grade: ${widget.title}'),
          actions: [
            BlocBuilder<GradingCubit, GradingState>(
              buildWhen: (prev, curr) => prev.roster != curr.roster,
              builder: (context, state) {
                final roster = state.roster;
                if (roster == null) return const SizedBox.shrink();
                final allGraded =
                    roster.students.every((s) => s.graded || !s.submitted);
                final gradesReleased = roster.assignment.gradesReleased;

                return PopupMenuButton<String>(
                  onSelected: (v) => _handleMenuAction(context, v),
                  itemBuilder: (_) => [
                    if (allGraded && !gradesReleased)
                      const PopupMenuItem(
                        value: 'release',
                        child: Text('Release All Grades'),
                      ),
                    if (gradesReleased)
                      const PopupMenuItem(
                        value: 'released',
                        enabled: false,
                        child: Text('Grades Released'),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
        body: BlocConsumer<GradingCubit, GradingState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == GradingStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            final roster = state.roster;
            if (roster == null) {
              return const Center(child: Text('No roster available'));
            }

            if (state.selectedStudent != null) {
              return _StudentDetail(
                student: state.selectedStudent!,
                assignment: roster.assignment,
                dark: dark,
                cubit: _cubit,
              );
            }

            return _StudentList(
              roster: roster,
              dark: dark,
              onStudentSelected: (i) => _cubit.selectStudent(i),
            );
          },
        ),
      ),
    );
  }

  void _handleMenuAction(BuildContext context, String action) {
    if (action == 'release') {
      _cubit.releaseGrades(widget.assignmentId);
    }
  }
}

// ── Student List ──

class _StudentList extends StatelessWidget {
  const _StudentList({
    required this.roster,
    required this.dark,
    required this.onStudentSelected,
  });

  final GradingRoster roster;
  final bool dark;
  final ValueChanged<int> onStudentSelected;

  @override
  Widget build(BuildContext context) {
    final students = roster.students;
    final summary = roster.summary;
    final assignment = roster.assignment;

    return Column(
      children: [
        _SummaryBar(
          summary: summary,
          marksAvailable: assignment.marksAvailable,
          gradesReleased: assignment.gradesReleased,
          dark: dark,
        ),
        Expanded(
          child: _FilterChips(
            students: students,
            dark: dark,
            onSelected: onStudentSelected,
          ),
        ),
      ],
    );
  }
}

// ── Summary Bar ──

class _SummaryBar extends StatelessWidget {
  const _SummaryBar({
    required this.summary,
    required this.marksAvailable,
    required this.gradesReleased,
    required this.dark,
  });

  final GradingSummary summary;
  final int marksAvailable;
  final bool gradesReleased;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      margin: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _SummaryItem(
                label: 'Enrolled',
                value: summary.enrolled.toString(),
                color: dark ? AppColorsDark.ink : AppColors.ink,
                dark: dark,
              ),
              _SummaryItem(
                label: 'Submitted',
                value: '${summary.submitted}/${summary.enrolled}',
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                dark: dark,
              ),
              _SummaryItem(
                label: 'Late',
                value: summary.late.toString(),
                color: AppColors.warn,
                dark: dark,
              ),
              _SummaryItem(
                label: 'Graded',
                value: '${summary.graded}/${summary.submitted}',
                color: AppColors.ok,
                dark: dark,
              ),
            ],
          ),
          if (gradesReleased)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.okBg,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  'Grades Released',
                  style: TextStyle(
                    color: AppColors.ok,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Summary Item ──

class _SummaryItem extends StatelessWidget {
  const _SummaryItem({
    required this.label,
    required this.value,
    required this.color,
    required this.dark,
  });

  final String label;
  final String value;
  final Color color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.w600,
            fontSize: 18,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: dark ? AppColorsDark.muted : AppColors.muted,
            fontSize: 11,
          ),
        ),
      ],
    );
  }
}

// ── Filter Chips ──

class _FilterChips extends StatelessWidget {
  const _FilterChips({
    required this.students,
    required this.dark,
    required this.onSelected,
  });

  final List<RosterStudent> students;
  final bool dark;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final notSubmitted = <_StudentEntry>[];
    final pending = <_StudentEntry>[];
    final graded = <_StudentEntry>[];

    for (var i = 0; i < students.length; i++) {
      final s = students[i];
      final entry = _StudentEntry(index: i, student: s);
      if (!s.submitted) {
        notSubmitted.add(entry);
      } else if (!s.graded) {
        pending.add(entry);
      } else {
        graded.add(entry);
      }
    }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      children: [
        if (pending.isNotEmpty) ...[
          _SectionHeader(
            title: 'Awaiting Grading',
            count: pending.length,
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
            dark: dark,
          ),
          ...pending.map((e) => _StudentTile(
                entry: e,
                dark: dark,
                onTap: () => onSelected(e.index),
              )),
        ],
        if (notSubmitted.isNotEmpty) ...[
          _SectionHeader(
            title: 'Not Submitted',
            count: notSubmitted.length,
            color: AppColors.warn,
            dark: dark,
          ),
          ...notSubmitted.map((e) => _StudentTile(
                entry: e,
                dark: dark,
                onTap: null,
              )),
        ],
        if (graded.isNotEmpty) ...[
          _SectionHeader(
            title: 'Graded',
            count: graded.length,
            color: AppColors.ok,
            dark: dark,
          ),
          ...graded.map((e) => _StudentTile(
                entry: e,
                dark: dark,
                onTap: () => onSelected(e.index),
              )),
        ],
      ],
    );
  }
}

class _StudentEntry {
  const _StudentEntry({required this.index, required this.student});
  final int index;
  final RosterStudent student;
}

// ── Section Header ──

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.count,
    required this.color,
    required this.dark,
  });

  final String title;
  final int count;
  final Color color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 4),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: color.withValues(alpha: dark ? 0.2 : 0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                color: color,
                fontWeight: FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            title,
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Student Tile ──

class _StudentTile extends StatelessWidget {
  const _StudentTile({
    required this.entry,
    required this.dark,
    required this.onTap,
  });

  final _StudentEntry entry;
  final bool dark;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final s = entry.student;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 2),
      color: dark ? AppColorsDark.surface : null,
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: s.submitted
              ? (s.graded ? AppColors.ok : (dark ? AppColorsDark.brand600 : AppColors.brand600))
              : (dark ? AppColorsDark.muted : AppColors.muted),
          child: Text(
            (s.rollNo ?? entry.index + 1).toString(),
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ),
        title: Text(
          s.name,
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: s.submitted
            ? Row(
                children: [
                  if (s.isLate)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 4, vertical: 1),
                      decoration: BoxDecoration(
                        color: AppColors.warnBg,
                        borderRadius: BorderRadius.circular(3),
                      ),
                      child: Text(
                        'Late ${s.minutesLate}m',
                        style: const TextStyle(
                          color: AppColors.warn,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  if (s.isLate) const SizedBox(width: 4),
                  if (s.graded)
                    Text(
                      'Grade: ${s.finalMarks ?? "-"}',
                      style: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                        fontSize: 12,
                      ),
                    )
                  else
                    Text(
                      'Submitted',
                      style: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                        fontSize: 12,
                      ),
                    ),
                ],
              )
            : Text(
                'Not submitted',
                style: TextStyle(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                  fontSize: 12,
                ),
              ),
        trailing: onTap != null
            ? Icon(
                Icons.chevron_right,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              )
            : null,
        onTap: onTap,
      ),
    );
  }
}

// ── Student Detail (Grading View) ──

class _StudentDetail extends StatefulWidget {
  const _StudentDetail({
    required this.student,
    required this.assignment,
    required this.dark,
    required this.cubit,
  });

  final RosterStudent student;
  final GradingAssignment assignment;
  final bool dark;
  final GradingCubit cubit;

  @override
  State<_StudentDetail> createState() => _StudentDetailState();
}

class _StudentDetailState extends State<_StudentDetail> {
  late final TextEditingController _marksController;
  late final TextEditingController _feedbackController;
  late final TextEditingController _notesController;
  late final TextEditingController _penaltyController;

  @override
  void initState() {
    super.initState();
    _marksController = TextEditingController(
      text: widget.student.rawMarks?.toString() ?? '',
    );
    _feedbackController = TextEditingController(
      text: widget.student.feedback ?? '',
    );
    _notesController = TextEditingController(
      text: widget.student.internalNotes ?? '',
    );
    _penaltyController = TextEditingController(
      text: widget.student.penaltyApplied?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _marksController.dispose();
    _feedbackController.dispose();
    _notesController.dispose();
    _penaltyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.student;
    final a = widget.assignment;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: s.graded ? AppColors.ok : (widget.dark ? AppColorsDark.brand600 : AppColors.brand600),
                child: Text(
                  (s.rollNo ?? '?').toString(),
                  style: const TextStyle(color: Colors.white),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      s.name,
                      style: TextStyle(
                        color: widget.dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.w600,
                        fontSize: 18,
                      ),
                    ),
                    if (s.isLate)
                      const Text(
                        'Late submission',
                        style: TextStyle(
                          color: AppColors.warn,
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          if (!s.submitted)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.warnBg,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Row(
                children: [
                  Icon(Icons.warning, color: AppColors.warn, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'Student has not submitted',
                    style: TextStyle(color: AppColors.warn),
                  ),
                ],
              ),
            ),

          if (s.submitted && s.files.isNotEmpty) ...[
            Text(
              'Submission',
              style: TextStyle(
                color: widget.dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            ...s.files.map((f) => Card(
                  color: widget.dark ? AppColorsDark.surface : null,
                  child: ListTile(
                    leading: Icon(
                      Icons.description,
                      color: widget.dark ? AppColorsDark.muted : AppColors.muted,
                    ),
                    title: Text(
                      f.filename,
                      style: TextStyle(
                        color: widget.dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                  ),
                )),
            const SizedBox(height: 12),
          ],

          if (s.submitted && s.textResponse != null) ...[
            Text(
              'Text Response',
              style: TextStyle(
                color: widget.dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: widget.dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Text(
                s.textResponse!,
                style: TextStyle(
                  color: widget.dark ? AppColorsDark.ink : AppColors.ink,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          if (s.submitted && s.files.isNotEmpty && s.submissionId != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: SubmissionCommentsWidget(
                submissionId: s.submissionId!,
                fileId: s.files.isNotEmpty ? s.files.first.id : null,
                filename: s.files.isNotEmpty ? s.files.first.filename : null,
              ),
            ),

          Text(
            'Grade',
            style: TextStyle(
              color: widget.dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          _GradingField(
            controller: _marksController,
            label: 'Raw Marks (out of ${a.marksAvailable})',
            dark: widget.dark,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 8),
          _GradingField(
            controller: _penaltyController,
            label: 'Penalty (points deducted)',
            dark: widget.dark,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 8),
          _GradingField(
            controller: _feedbackController,
            label: 'Feedback to Student',
            dark: widget.dark,
            maxLines: 3,
          ),
          const SizedBox(height: 12),
          // Voice feedback section
          _VoiceFeedbackSection(
            submissionId: widget.student.submissionId,
            repository: context.read<MarkingRepository>(),
            dark: widget.dark,
          ),
          const SizedBox(height: 8),
          _GradingField(
            controller: _notesController,
            label: 'Internal Notes (not visible to student)',
            dark: widget.dark,
            maxLines: 2,
          ),
          const SizedBox(height: 16),

          BlocBuilder<GradingCubit, GradingState>(
            builder: (context, state) {
              return Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: state.grading
                          ? null
                          : () => widget.cubit.previousStudent(),
                      icon: const Icon(Icons.arrow_back),
                      label: const Text('Previous'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: state.grading
                          ? null
                          : () => _saveGrade(context),
                      child: state.grading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Save'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: state.grading
                          ? null
                          : () => widget.cubit.nextStudent(),
                      icon: const Icon(Icons.arrow_forward),
                      label: const Text('Next'),
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  void _saveGrade(BuildContext context) {
    final marks = num.tryParse(_marksController.text);
    if (marks == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid mark')),
      );
      return;
    }

    final penalty = num.tryParse(_penaltyController.text);
    final feedback = _feedbackController.text.isNotEmpty
        ? _feedbackController.text
        : null;
    final notes =
        _notesController.text.isNotEmpty ? _notesController.text : null;

    widget.cubit.gradeStudent(
      assignmentId: widget.assignment.id,
      studentId: widget.student.studentId,
      rawMarks: marks,
      penaltyApplied: penalty,
      feedback: feedback,
      internalNotes: notes,
    );
  }
}

// ── Grading Field ──

class _GradingField extends StatelessWidget {
  const _GradingField({
    required this.controller,
    required this.label,
    required this.dark,
    this.keyboardType,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final bool dark;
  final TextInputType? keyboardType;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(
          color: dark ? AppColorsDark.muted : AppColors.muted,
        ),
        filled: true,
        fillColor: dark ? AppColorsDark.surface : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.sm),
          borderSide: BorderSide(
            color: dark ? AppColorsDark.line : AppColors.line,
          ),
        ),
      ),
      style: TextStyle(
        color: dark ? AppColorsDark.ink : AppColors.ink,
      ),
    );
  }
}

/// Voice feedback section — record and upload spoken feedback for a student.
class _VoiceFeedbackSection extends StatefulWidget {
  const _VoiceFeedbackSection({
    required this.submissionId,
    required this.repository,
    required this.dark,
  });

  final String? submissionId;
  final MarkingRepository repository;
  final bool dark;

  @override
  State<_VoiceFeedbackSection> createState() => _VoiceFeedbackSectionState();
}

class _VoiceFeedbackSectionState extends State<_VoiceFeedbackSection> {
  final _recorder = AudioRecorder();
  bool _isRecording = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _toggleRecording() async {
    if (_isRecording) {
      final path = await _recorder.stop();
      setState(() => _isRecording = false);
      if (path != null && widget.submissionId != null) {
        await _uploadRecording(path);
      }
    } else {
      if (!await _recorder.hasPermission()) return;
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/feedback_${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _recorder.start(
        const RecordConfig(),
        path: path,
      );
      setState(() => _isRecording = true);
    }
  }

  Future<void> _uploadRecording(String path) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.uploadFeedbackAudio(
        submissionId: widget.submissionId!,
        filePath: path,
        fileName: 'feedback.m4a',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Voice feedback uploaded')),
        );
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Could not upload recording');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.submissionId == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: widget.dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.mic,
                size: 18,
                color: widget.dark ? AppColorsDark.muted : AppColors.muted,
              ),
              const SizedBox(width: 8),
              const Text(
                'Voice Feedback',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: TextStyle(
                  fontSize: 12,
                  color: widget.dark ? AppColorsDark.error : AppColors.error,
                ),
              ),
            ),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _toggleRecording,
                  icon: Icon(
                    _isRecording ? Icons.stop : Icons.mic,
                    size: 18,
                  ),
                  label: Text(
                    _busy
                        ? 'Uploading…'
                        : _isRecording
                            ? 'Stop Recording'
                            : 'Record Feedback',
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _isRecording
                        ? (widget.dark ? AppColorsDark.error : AppColors.error)
                        : null,
                  ),
                ),
              ),
            ],
          ),
          if (_isRecording)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: widget.dark ? AppColorsDark.error : AppColors.error,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Recording…',
                    style: TextStyle(
                      fontSize: 12,
                      color: widget.dark ? AppColorsDark.error : AppColors.error,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
