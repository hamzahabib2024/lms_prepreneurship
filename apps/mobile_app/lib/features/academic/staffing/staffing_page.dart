import 'package:flutter/material.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../data/academic_repository.dart';
import '../data/models/timetable.dart';

const _roles = ['PRIMARY', 'SUPPORTING', 'SUBSTITUTE'];

String pretty(String s) => s.toLowerCase().replaceAll('_', ' ');

/// Teaching staff — FR-CRS-015..025, BR-ACC-04.
///
/// A teacher's authority is a subject WITHIN a section, never a subject
/// everywhere. The workload is read BEFORE assigning (FR-CRS-015), so an
/// overload is noticed first rather than discovered after.
class StaffingPage extends StatefulWidget {
  const StaffingPage({super.key, required this.api});

  final ApiClient api;

  @override
  State<StaffingPage> createState() => _StaffingPageState();
}

class _StaffingPageState extends State<StaffingPage> {
  late final AcademicRepository _repository;

  List<TeacherLoad> _rows = const [];
  bool _loading = true;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _repository.teacherWorkload();
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Teaching staff'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: _loading && _rows.isEmpty
            ? const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 5),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                children: [
                  if (_error != null) ...[
                    AppAlert(
                      title: 'That did not work',
                      message: _error!.message,
                      reference: _error!.reference,
                      details: serverDetailLines(_error!),
                    ),
                    const SizedBox(height: 14),
                  ],
                  Text(
                    '${_rows.length} ${_rows.length == 1 ? 'teacher' : 'teachers'} · '
                    'assignments are to a subject within a section',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                  const SizedBox(height: 8),
                  if (_rows.isEmpty)
                    Text(
                      'No teachers yet. Invite staff under Users; teachers earn '
                      'reach only through an assignment.',
                      style: TextStyle(
                        fontSize: 13.5,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        height: 1.5,
                      ),
                    )
                  else
                    for (final t in _rows)
                      _TeacherCard(
                        teacher: t,
                        busy: _loading,
                        onOpen: () => _openTeacher(t),
                      ),
                ],
              ),
      ),
    );
  }

  Future<void> _openTeacher(TeacherLoad teacher) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _TeacherDetailPage(
          teacher: teacher,
          repository: _repository,
        ),
      ),
    );
    _load();
  }
}

class _TeacherCard extends StatelessWidget {
  const _TeacherCard({required this.teacher, required this.busy, required this.onOpen});

  final TeacherLoad teacher;
  final bool busy;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final t = teacher;
    final active = t.status == 'ACTIVE' || t.status == 'INVITED';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.name,
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${t.subjectSections} ${t.subjectSections == 1 ? 'class' : 'classes'} · '
                        '${t.students} ${t.students == 1 ? 'student' : 'students'}',
                        style: TextStyle(fontSize: 12, color: muted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Pill(
                  text: pretty(t.status),
                  kind: active ? PillKind.ok : PillKind.warn,
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

class _TeacherDetailPage extends StatefulWidget {
  const _TeacherDetailPage({required this.teacher, required this.repository});

  final TeacherLoad teacher;
  final AcademicRepository repository;

  @override
  State<_TeacherDetailPage> createState() => _TeacherDetailPageState();
}

class _TeacherDetailPageState extends State<_TeacherDetailPage> {
  List<TeacherAssignment> _rows = const [];
  List<OfferingChoice> _choices = const [];
  bool _loading = true;
  bool _busy = false;
  ApiException? _error;
  String? _note;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.repository.teacherAssignments(widget.teacher.teacherId),
        widget.repository.offeringChoices(),
      ]);
      if (!mounted) return;
      setState(() {
        _rows = results[0] as List<TeacherAssignment>;
        _choices = results[1] as List<OfferingChoice>;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error;
      });
    }
  }

  Future<void> _assign() async {
    // FR-CRS-022 — several teachers may share a class, so only what THIS
    // teacher already teaches live is hidden, not everything with a host.
    final taken = _rows
        .where((a) => a.isLive)
        .map((a) => a.sectionSubjectId)
        .toSet();
    final created = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _AssignSheet(
        repository: widget.repository,
        teacherId: widget.teacher.teacherId,
        choices: _choices,
        taken: taken,
      ),
    );
    if (created == true && mounted) {
      setState(() => _note = 'Assignment created.');
      await _load();
    }
  }

  Future<void> _end(TeacherAssignment assignment) async {
    final reason = await _askReason(assignment);
    if (reason == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.endAssignment(
        assignment.id,
        reason: reason.trim().isEmpty ? null : reason.trim(),
      );
      if (!mounted) return;
      setState(() => _note = 'Assignment ended.');
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// FR-CRS-023 — ending an assignment revokes reach; the reason is recorded
  /// in the audit trail, so it is asked rather than invented later.
  Future<String?> _askReason(TeacherAssignment assignment) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('End ${assignment.subjectName} in ${assignment.sectionCode}?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'The teacher loses access to this class on the very next request. '
              'The row stays for history.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Reason (optional)',
                hintText: 'Transferring to another section…',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('End assignment'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final t = widget.teacher;

    return Scaffold(
      appBar: AppBar(
        title: Text(t.name),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: _loading && _rows.isEmpty
            ? const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 4),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                children: [
                  if (_error != null) ...[
                    AppAlert(
                      title: 'That did not work',
                      message: _error!.message,
                      reference: _error!.reference,
                      details: serverDetailLines(_error!),
                    ),
                    const SizedBox(height: 14),
                  ],
                  if (_note != null) ...[
                    Text(
                      _note!,
                      style: TextStyle(
                        fontSize: 13.5,
                        color: dark ? AppColorsDark.ok : AppColors.ok,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],
                  Text(
                    '${t.subjectSections} classes · ${t.students} students across them',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : () => _assign(),
                    icon: const Icon(Icons.person_add_alt, size: 18),
                    label: const Text('Assign a subject'),
                  ),
                  const SizedBox(height: 14),
                  if (_rows.isEmpty)
                    Text(
                      'No assignments yet. An assignment is to a subject WITHIN '
                      'a section, and is the only thing that gives a teacher reach.',
                      style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                    )
                  else
                    for (final a in _rows)
                      Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.surface,
                          border: Border.all(
                            color: dark ? AppColorsDark.line : AppColors.line,
                          ),
                          borderRadius: BorderRadius.circular(AppRadius.md),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${a.subjectCode} — ${a.subjectName}',
                                    style: const TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                Pill(
                                  text: a.isLive ? 'live' : 'ended',
                                  kind: a.isLive ? PillKind.ok : PillKind.neutral,
                                ),
                              ],
                            ),
                            const SizedBox(height: 3),
                            Text(
                              [
                                '${a.sectionCode} · ${pretty(a.sectionShift)}',
                                pretty(a.assignmentRole),
                                '${a.enrolled} ${a.enrolled == 1 ? 'student' : 'students'}',
                                a.isLive && a.endDate != null
                                    ? 'until ${Formats.shortDate(a.endDate!)}'
                                    : a.isLive
                                        ? 'since ${Formats.shortDate(a.startDate)}'
                                        : 'ended ${Formats.shortDate(a.endDate ?? a.startDate)}',
                              ].join(' · '),
                              style: TextStyle(fontSize: 12, color: muted),
                            ),
                            if (a.isLive)
                              Align(
                                alignment: Alignment.centerRight,
                                child: TextButton(
                                  onPressed: _busy ? null : () => _end(a),
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                    foregroundColor: dark ? AppColorsDark.error : AppColors.error,
                                    textStyle: const TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  child: const Text('End assignment'),
                                ),
                              ),
                          ],
                        ),
                      ),
                ],
              ),
      ),
    );
  }
}

/// FR-CRS-021..025 — choose the class, the role, and the term.
class _AssignSheet extends StatefulWidget {
  const _AssignSheet({
    required this.repository,
    required this.teacherId,
    required this.choices,
    required this.taken,
  });

  final AcademicRepository repository;
  final String teacherId;
  final List<OfferingChoice> choices;
  final Set<String> taken;

  @override
  State<_AssignSheet> createState() => _AssignSheetState();
}

class _AssignSheetState extends State<_AssignSheet> {
  String _sectionSubjectId = '';
  String _role = 'PRIMARY';
  DateTime? _startDate;
  DateTime? _endDate;
  bool _busy = false;
  ApiException? _error;

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.createAssignment(
        teacherId: widget.teacherId,
        sectionSubjectId: _sectionSubjectId,
        assignmentRole: _role,
        startDate: _startDate ?? DateTime.now(),
        endDate: _endDate,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    final options = widget.choices
        .where((c) => !widget.taken.contains(c.id))
        .toList();

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Assign a subject',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_error != null) ...[
                    AppAlert(
                      title: 'That did not work',
                      message: _error!.message,
                      reference: _error!.reference,
                      details: serverDetailLines(_error!),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (options.isEmpty)
                    Text(
                      'Every subject is already taught in every section, or has '
                      'already got a host teacher.',
                      style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                    ),
                  AdmissionSelectField(
                    label: 'Class',
                    value: _sectionSubjectId,
                    hint: 'Choose…',
                    options: [
                      for (final o in options) (o.id, o.label),
                    ],
                    onChanged: (v) => setState(() => _sectionSubjectId = v),
                  ),
                  const SizedBox(height: 12),
                  AdmissionSelectField(
                    label: 'Role',
                    value: _role,
                    hint: 'Choose…',
                    options: [for (final r in _roles) (r, pretty(r))],
                    onChanged: (v) => setState(() => _role = v),
                  ),
                  const SizedBox(height: 12),
                  AdmissionDateField(
                    label: 'Starts',
                    value: _startDate,
                    hint: 'Today',
                    firstDate: DateTime.now().subtract(const Duration(days: 30)),
                    lastDate: DateTime.now().add(const Duration(days: 730)),
                    onChanged: (v) => setState(() => _startDate = v),
                  ),
                  const SizedBox(height: 12),
                  AdmissionDateField(
                    label: 'Ends (optional)',
                    value: _endDate,
                    hint: 'No end date',
                    firstDate: DateTime.now().subtract(const Duration(days: 30)),
                    lastDate: DateTime.now().add(const Duration(days: 730)),
                    onChanged: (v) => setState(() => _endDate = v),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _busy || _sectionSubjectId.isEmpty
                        ? null
                        : () => _submit(),
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Create assignment'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}