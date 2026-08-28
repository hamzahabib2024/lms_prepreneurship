import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/learning_repository.dart';
import '../data/models/learning_models.dart';

/// Assignments for one subject — SRS §13.5, FR-ASG-011/013/014.
///
/// The deadline is the thing a student is here for, so it is stated in plain
/// words ("due in 3 days", "2 days overdue") rather than only as a date.
class AssignmentPanel extends StatefulWidget {
  const AssignmentPanel({
    super.key,
    required this.api,
    required this.user,
    required this.sectionSubjectId,
  });

  final ApiClient api;
  final AuthUser user;
  final String sectionSubjectId;

  @override
  State<AssignmentPanel> createState() => _AssignmentPanelState();
}

class _AssignmentPanelState extends State<AssignmentPanel> {
  late final LearningRepository _repository;
  List<StudentAssignment>? _items;
  ApiException? _error;
  String? _openId;

  @override
  void initState() {
    super.initState();
    _repository = LearningRepository(api: widget.api);
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await _repository.myAssignments(widget.sectionSubjectId);
      if (!mounted) return;
      setState(() => _items = items);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Assignments',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 12),
        if (_error != null) ...[
          AppAlert(
            title: 'Could not load assignments',
            message: _error!.message,
            reference: _error!.reference,
          ),
          const SizedBox(height: 12),
        ],
        if (_items == null && _error == null)
          const SkeletonCards(count: 2)
        else if (_items != null && _items!.isEmpty)
          Text(
            'No assignments have been set for this subject yet.',
            style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
          )
        else if (_items != null)
          for (final a in _items!)
            _AssignmentCard(
              assignment: a,
              expanded: _openId == a.id,
              onToggle: () {
                setState(() {
                  _openId = _openId == a.id ? null : a.id;
                });
              },
              repository: _repository,
              onChanged: _load,
            ),
      ],
    );
  }
}

class _AssignmentCard extends StatelessWidget {
  const _AssignmentCard({
    required this.assignment,
    required this.expanded,
    required this.onToggle,
    required this.repository,
    required this.onChanged,
  });

  final StudentAssignment assignment;
  final bool expanded;
  final VoidCallback onToggle;
  final LearningRepository repository;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final a = assignment;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onToggle,
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          a.title,
                          style: const TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _StatusBadge(assignment: a),
                      const SizedBox(width: 8),
                      Text(
                        '${a.marksAvailable} marks',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    a.deadlineText,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: a.isOverdue && !a.submitted
                          ? (dark ? AppColorsDark.warn : AppColors.warn)
                          : muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (expanded) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (a.instructions.isNotEmpty)
                    Text(
                      a.instructions,
                      style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                    ),
                  if (a.hasBriefAudio) ...[
                    const SizedBox(height: 8),
                    _BriefAudioPlayer(
                      assignmentId: a.id,
                      seconds: a.briefAudioSeconds,
                      repository: repository,
                    ),
                  ],
                  if (a.submissionId != null && (a.grade?.feedback != null || a.hasFeedbackAudio)) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Your feedback',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                          ),
                          if (a.grade?.feedback != null) ...[
                            const SizedBox(height: 4),
                            Text(
                              a.grade!.feedback!,
                              style: TextStyle(fontSize: 13, color: muted, height: 1.5),
                            ),
                          ],
                          if (a.hasFeedbackAudio) ...[
                            const SizedBox(height: 8),
                            _FeedbackAudioPlayer(
                              submissionId: a.submissionId!,
                              seconds: a.feedbackAudioSeconds,
                              repository: repository,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                  if (a.canSubmit) ...[
                    const SizedBox(height: 12),
                    _SubmitPanel(
                      assignment: a,
                      repository: repository,
                      onChanged: onChanged,
                    ),
                  ] else ...[
                    const SizedBox(height: 8),
                    Text(
                      a.submitted
                          ? 'You have submitted this assignment and it cannot be changed.'
                          : 'This assignment is not open for submission.',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.assignment});

  final StudentAssignment assignment;

  @override
  Widget build(BuildContext context) {
    final a = assignment;
    final dark = Theme.of(context).brightness == Brightness.dark;

    if (a.grade?.status == 'RELEASED' && a.grade?.finalMarks != null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            '${a.grade!.finalMarks}/${a.marksAvailable}',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
          if (a.grade!.penaltyApplied != null && a.grade!.penaltyApplied! > 0)
            Text(
              ' (−${a.grade!.penaltyApplied} late)',
              style: TextStyle(
                fontSize: 11,
                color: dark ? AppColorsDark.warn : AppColors.warn,
              ),
            ),
        ],
      );
    }
    if (a.submitted) {
      return Pill(
        text: 'Submitted${a.wasLate ? ' (late)' : ''}',
        kind: PillKind.ok,
      );
    }
    if (!a.isOpen) {
      return const Pill(text: 'Closed', kind: PillKind.neutral);
    }
    return const Pill(text: 'Not submitted', kind: PillKind.neutral);
  }
}

class _BriefAudioPlayer extends StatefulWidget {
  const _BriefAudioPlayer({
    required this.assignmentId,
    this.seconds,
    required this.repository,
  });

  final String assignmentId;
  final int? seconds;
  final LearningRepository repository;

  @override
  State<_BriefAudioPlayer> createState() => _BriefAudioPlayerState();
}

class _BriefAudioPlayerState extends State<_BriefAudioPlayer> {
  String? _path;
  bool _busy = false;
  bool _failed = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Row(
        children: [
          Icon(Icons.record_voice_over_outlined, size: 18, color: muted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'The teacher recorded a brief',
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                ),
                if (_failed)
                  Text(
                    'It could not be loaded. Try again.',
                    style: TextStyle(fontSize: 11, color: muted),
                  ),
                if (widget.seconds != null)
                  Text(
                    '${widget.seconds! ~/ 60}:${(widget.seconds! % 60).toString().padLeft(2, '0')}',
                    style: TextStyle(fontSize: 11, color: muted),
                  ),
              ],
            ),
          ),
          if (_path != null)
            const Icon(Icons.play_circle_outline, size: 24)
          else
            TextButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      try {
                        final bytes = await widget.repository
                            .downloadBriefAudio(widget.assignmentId);
                        final dir = await getTemporaryDirectory();
                        final file = File(
                          '${dir.path}/brief_${widget.assignmentId}.webm',
                        );
                        await file.writeAsBytes(bytes);
                        if (mounted) setState(() => _path = file.path);
                      } catch (e) {
                        if (mounted) setState(() => _failed = true);
                      } finally {
                        if (mounted) setState(() => _busy = false);
                      }
                    },
              child: Text(_busy ? 'Loading…' : 'Listen'),
            ),
        ],
      ),
    );
  }
}

class _FeedbackAudioPlayer extends StatefulWidget {
  const _FeedbackAudioPlayer({
    required this.submissionId,
    this.seconds,
    required this.repository,
  });

  final String submissionId;
  final int? seconds;
  final LearningRepository repository;

  @override
  State<_FeedbackAudioPlayer> createState() => _FeedbackAudioPlayerState();
}

class _FeedbackAudioPlayerState extends State<_FeedbackAudioPlayer> {
  String? _path;
  bool _busy = false;
  bool _failed = false;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      children: [
        Expanded(
          child: Text(
            'Your teacher recorded feedback for you',
            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: muted),
          ),
        ),
        if (_failed)
          Text(
            'Could not load',
            style: TextStyle(fontSize: 11, color: muted),
          )
        else if (_path != null)
          const Icon(Icons.play_circle_outline, size: 20)
        else
          TextButton(
            onPressed: _busy
                ? null
                : () async {
                    setState(() => _busy = true);
                    try {
                      final bytes = await widget.repository
                          .downloadFeedbackAudio(widget.submissionId);
                      final dir = await getTemporaryDirectory();
                      final file = File(
                        '${dir.path}/feedback_${widget.submissionId}.webm',
                      );
                      await file.writeAsBytes(bytes);
                      if (mounted) setState(() => _path = file.path);
                    } catch (e) {
                      if (mounted) setState(() => _failed = true);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
            child: Text(_busy ? 'Loading…' : 'Listen'),
          ),
      ],
    );
  }
}

class _SubmitPanel extends StatefulWidget {
  const _SubmitPanel({
    required this.assignment,
    required this.repository,
    required this.onChanged,
  });

  final StudentAssignment assignment;
  final LearningRepository repository;
  final VoidCallback onChanged;

  @override
  State<_SubmitPanel> createState() => _SubmitPanelState();
}

class _SubmitPanelState extends State<_SubmitPanel> {
  final _textController = TextEditingController();
  List<PendingFile> _files = [];
  bool _busy = false;
  ApiException? _error;
  String? _done;

  @override
  void initState() {
    super.initState();
    _loadFiles();
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _loadFiles() async {
    try {
      final files = await widget.repository.assignmentFiles(widget.assignment.id);
      if (!mounted) return;
      setState(() => _files = files);
    } on ApiException {
      // Silently fail — files are non-critical.
    }
  }

  Future<void> _upload() async {
    final result = await FilePicker.pickFiles();
    if (result.isEmpty) return;
    final file = result.first;
    if (file.path == null) return;

    setState(() => _busy = true);
    try {
      await widget.repository.uploadAssignmentFile(
        assignmentId: widget.assignment.id,
        filePath: file.path!,
        fileName: file.name,
      );
      _loadFiles();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(String fileId) async {
    try {
      await widget.repository.removeAssignmentFile(fileId);
      _loadFiles();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _done = null;
    });
    try {
      final result = await widget.repository.submitAssignment(
        assignmentId: widget.assignment.id,
        textResponse: _textController.text,
        fileIds: _files.map((f) => f.id).toList(),
      );
      if (mounted) {
        setState(() {
          _done = result.isLate
              ? 'Submitted, but after the deadline. A late penalty may apply.'
              : 'Submitted.';
          _textController.clear();
        });
        _loadFiles();
        widget.onChanged();
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final a = widget.assignment;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (a.submissionType != 'FILE') ...[
          Text(
            'Your response',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink2 : AppColors.ink2,
            ),
          ),
          const SizedBox(height: 6),
          TextFormField(
            controller: _textController,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: 'Type your answer here.',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
        ],
        if (a.submissionType != 'TEXT') ...[
          Text(
            'Attach a file',
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: dark ? AppColorsDark.ink2 : AppColors.ink2,
            ),
          ),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            onPressed: _busy || _files.length >= a.maxFileCount ? null : _upload,
            icon: const Icon(Icons.attach_file, size: 18),
            label: Text(_busy ? 'Uploading…' : 'Choose file'),
          ),
          const SizedBox(height: 4),
          Text(
            '${a.allowedFileTypes.map((t) => '.$t').join(', ')} · up to ${a.maxFileSizeMb} MB each · '
            'at most ${a.maxFileCount} file${a.maxFileCount == 1 ? '' : 's'}',
            style: TextStyle(fontSize: 11.5, color: muted),
          ),
          if (_files.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final f in _files)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    const Icon(Icons.description_outlined, size: 16),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            f.filename,
                            style: const TextStyle(fontSize: 12.5),
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            f.sizeLabel,
                            style: TextStyle(fontSize: 11, color: muted),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => _remove(f.id),
                      icon: const Icon(Icons.close, size: 16),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
              ),
          ],
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          AppAlert(
            title: 'That did not work',
            message: _error!.message,
            reference: _error!.reference,
          ),
        ],
        if (_done != null) ...[
          const SizedBox(height: 8),
          Text(_done!, style: const TextStyle(fontSize: 13)),
        ],
        const SizedBox(height: 12),
        SizedBox(
          height: 44,
          child: FilledButton(
            onPressed: _busy || (_files.isEmpty && _textController.text.trim().isEmpty)
                ? null
                : _submit,
            child: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(a.submitted ? 'Submit again' : 'Submit'),
          ),
        ),
        if (a.isOverdue) ...[
          const SizedBox(height: 8),
          Text(
            'This is past the deadline. ${_latePolicyText(a.latePolicy)}',
            style: TextStyle(
              fontSize: 12.5,
              color: dark ? AppColorsDark.warn : AppColors.warn,
            ),
          ),
        ],
      ],
    );
  }

  String _latePolicyText(String policy) {
    switch (policy) {
      case 'NOT_ACCEPTED':
        return 'Late work is not accepted.';
      case 'FIXED_DEDUCTION':
        return 'A fixed deduction will apply.';
      case 'PER_DAY_PERCENT':
        return 'A penalty applies for each day late.';
      default:
        return 'It will be marked as late.';
    }
  }
}
