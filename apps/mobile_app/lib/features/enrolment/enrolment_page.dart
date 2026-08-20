import 'package:flutter/material.dart';

import '../../core/formats.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/widgets/ui.dart';
import '../academic/data/academic_repository.dart';
import '../academic/data/models/section.dart';
import '../admission/widgets/form_controls.dart';
import '../auth/data/models/auth_session.dart';
import 'data/enrolment_repository.dart';
import 'data/models/enrolment.dart';

/// Student enrolment management — SRS §5.4 and §5.24, the mobile equivalent
/// of the web's Enrolments and Bulk screens.
///
/// Read access (a roster, a student's history) is offered to staff; every
/// write — transfer, suspension, withdrawal, reinstate, and the bulk endpoints
/// — is offered to the office alone. The server is what actually refuses
/// (ARC-003); this page only keeps the interface from offering what would be
/// refused. Teachers see rosters for their own sections, already scoped by
/// the server.
class EnrolmentPage extends StatefulWidget {
  const EnrolmentPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<EnrolmentPage> createState() => _EnrolmentPageState();
}

class _EnrolmentPageState extends State<EnrolmentPage> {
  late final EnrolmentRepository _repository;
  late final AcademicRepository _academic;
  late final bool _mayManage;

  List<Section> _sections = const [];
  List<RosterRow> _roster = const [];
  String _sectionId = '';
  bool _loading = true;
  ApiException? _error;
  String? _note;

  @override
  void initState() {
    super.initState();
    _repository = EnrolmentRepository(api: widget.api);
    _academic = AcademicRepository(api: widget.api);
    _mayManage = widget.user.isAdmin || widget.user.isSuperAdmin;
    _loadSections();
  }

  Future<void> _loadSections() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final sections = await _academic.listSections();
      if (!mounted) return;
      setState(() {
        _sections = sections;
        // Prefer the first live section; fall back to the first of any.
        final live = sections.where((s) => s.status != 'ARCHIVED').toList();
        _sectionId = live.isNotEmpty ? live.first.id : (sections.isEmpty ? '' : sections.first.id);
        _loading = false;
      });
      if (_sectionId.isNotEmpty) await _loadRoster();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error;
      });
    }
  }

  Future<void> _loadRoster() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final roster = await _repository.roster(_sectionId);
      if (!mounted) return;
      setState(() {
        _roster = roster;
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
    final section = _sections.where((s) => s.id == _sectionId).firstOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Enrolment'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          if (_mayManage)
            IconButton(
              onPressed: _sectionId.isEmpty || _roster.isEmpty ? null : () => _openBulk(section),
              icon: const Icon(Icons.groups_outlined),
              tooltip: 'Bulk operations',
            ),
        ],
      ),
      body: SafeArea(
        child: _loading && _sections.isEmpty
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
                  if (_sections.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AdmissionSelectField(
                        label: 'Section',
                        value: _sectionId,
                        hint: 'Choose one',
                        options: [
                          for (final s in _sections)
                            (
                              s.id,
                              '${s.code} · ${s.name}'
                                  '${s.isFull ? ' — full' : ' — ${s.placesRemaining} free'}',
                            ),
                        ],
                        onChanged: (v) {
                          setState(() => _sectionId = v);
                          _loadRoster();
                        },
                      ),
                    ),
                  if (section != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        '${_roster.length} ${_roster.length == 1 ? 'student' : 'students'}'
                        ' · ${section.enrolledCount} enrolled of ${section.capacity}',
                        style: TextStyle(fontSize: 12.5, color: muted),
                      ),
                    ),
                  if (_sections.isEmpty && !_loading)
                    const _EmptyHint(
                      'No sections yet. A section must exist before students can be '
                      'enrolled into it — create one under Academic → Sections first.',
                    )
                  else if (_loading)
                    const SkeletonCards(count: 3)
                  else if (_roster.isEmpty)
                    const _EmptyHint(
                      'This section has no students yet. Students join it when an '
                      'admission is approved, or when they are moved here with the '
                      'transfer or bulk operations.',
                    )
                  else
                    for (final row in _roster)
                      _RosterCard(
                        row: row,
                        busy: false,
                        onTap: section == null ? null : () => _openStudent(section, row),
                      ),
                  const SizedBox(height: 8),
                  if (_mayManage)
                    Text(
                      'Transfer, suspension and withdrawal appear on a student\'s '
                      'record. Bulk operations move or withdraw a whole section of '
                      'students at once.',
                      style: TextStyle(fontSize: 12, color: muted, height: 1.5),
                    ),
                ],
              ),
      ),
    );
  }

  // ------------------------------------------------------------ bulk -------

  Future<void> _openBulk(Section? section) async {
    if (section == null) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => BulkPage(api: widget.api, source: section, roster: _roster),
      ),
    );
    if (mounted) await _loadRoster();
  }

  // ------------------------------------------------------------- student ----

  Future<void> _openStudent(Section section, RosterRow row) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _StudentSheet(
        repository: _repository,
        section: section,
        row: row,
        mayManage: _mayManage,
        sections: _sections,
      ),
    );
    if (changed == true && mounted) {
      setState(() => _note = 'Student record updated.');
      await _loadRoster();
    }
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12, top: 2),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 13.5,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          height: 1.5,
        ),
      ),
    );
  }
}

String _pretty(String s) => s.toLowerCase().replaceAll('_', ' ');

PillKind _accountPill(String status) => switch (status) {
      'ACTIVE' => PillKind.ok,
      'SUSPENDED' => PillKind.warn,
      _ => PillKind.neutral,
    };

PillKind _enrolmentPill(String status) => switch (status) {
      'ACTIVE' => PillKind.ok,
      'WITHDRAWN' || 'SUSPENDED' => PillKind.warn,
      _ => PillKind.neutral,
    };

class _RosterCard extends StatelessWidget {
  const _RosterCard({required this.row, required this.busy, required this.onTap});

  final RosterRow row;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

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
          onTap: busy ? null : onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                  ),
                  child: Text(
                    '${row.rollNo ?? '—'}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        row.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        row.registrationNo,
                        style: TextStyle(fontSize: 11.5, color: muted, fontFamily: 'monospace'),
                      ),
                      if (row.subjects.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 4,
                          runSpacing: 4,
                          children: [
                            for (final code in row.subjects)
                              Container(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                                  borderRadius: BorderRadius.circular(AppRadius.sm),
                                ),
                                child: Text(
                                  code,
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    fontFamily: 'monospace',
                                    fontWeight: FontWeight.w600,
                                    color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Pill(
                  text: _pretty(row.accountStatus),
                  kind: _accountPill(row.accountStatus),
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

/// One student's record: profile, the complete enrolment history
/// (FR-ENR-021, retained across every state change), and — for the office —
/// the lifecycle actions.
class _StudentSheet extends StatefulWidget {
  const _StudentSheet({
    required this.repository,
    required this.section,
    required this.row,
    required this.mayManage,
    required this.sections,
  });

  final EnrolmentRepository repository;
  final Section section;
  final RosterRow row;
  final bool mayManage;
  final List<Section> sections;

  @override
  State<_StudentSheet> createState() => _StudentSheetState();
}

class _StudentSheetState extends State<_StudentSheet> {
  List<EnrolmentRow>? _history;
  ApiException? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final history = await widget.repository.history(widget.row.studentId);
      if (!mounted) return;
      setState(() => _history = history);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<bool> _act(Future<void> Function() work) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
      if (!mounted) return false;
      Navigator.of(context).pop(true);
      return true;
    } on ApiException catch (error) {
      if (!mounted) return false;
      setState(() {
        _busy = false;
        _error = error;
      });
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final row = widget.row;
    final history = _history;
    final isActive = row.accountStatus == 'ACTIVE';

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(row.name, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 2),
                      Text(
                        '${row.registrationNo} · roll ${row.rollNo ?? '—'}',
                        style: TextStyle(fontSize: 12.5, color: muted, fontFamily: 'monospace'),
                      ),
                    ],
                  ),
                ),
                Pill(text: _pretty(row.accountStatus), kind: _accountPill(row.accountStatus)),
              ],
            ),
            const SizedBox(height: 14),
            if (_error != null) ...[
              AppAlert(
                title: 'That did not work',
                message: _error!.message,
                reference: _error!.reference,
                details: serverDetailLines(_error!),
              ),
              const SizedBox(height: 12),
            ],
            if (widget.mayManage) ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: _busy ? null : () => _transfer(),
                    icon: const Icon(Icons.swap_horiz, size: 18),
                    label: const Text('Transfer'),
                  ),
                  if (isActive)
                    FilledButton.tonalIcon(
                      onPressed: _busy ? null : () => _suspend(),
                      icon: const Icon(Icons.pause_circle_outline, size: 18),
                      label: const Text('Suspend'),
                    ),
                  if (isActive || row.accountStatus == 'SUSPENDED')
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _withdraw(),
                      icon: const Icon(Icons.logout_rounded, size: 18),
                      label: const Text('Withdraw'),
                    ),
                  if (!isActive)
                    TextButton.icon(
                      onPressed: _busy ? null : () => _reinstate(),
                      icon: const Icon(Icons.replay_rounded, size: 18),
                      label: const Text('Reinstate'),
                    ),
                ],
              ),
              const SizedBox(height: 14),
            ],
            Text('Enrolment history', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            if (history == null)
              const Skeleton(lines: 3)
            else if (history.isEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  'No enrolment rows yet — the student has never been enrolled in a subject.',
                  style: TextStyle(fontSize: 13.5, color: muted),
                ),
              )
            else
              for (final e in history)
                Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${e.subjectCode}  ${e.subjectName}',
                              style: const TextStyle(
                                  fontSize: 13.5, fontWeight: FontWeight.w600),
                            ),
                          ),
                          Pill(text: _pretty(e.status), kind: _enrolmentPill(e.status)),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${e.sectionCode} · roll ${e.rollNoAtEnrolment ?? '—'}'
                        '${e.enrolledAt != null ? ' · from ${Formats.shortDate(e.enrolledAt!)}' : ''}'
                        '${e.endedAt != null ? ' to ${Formats.shortDate(e.endedAt!)}' : ''}',
                        style: TextStyle(fontSize: 11.5, color: muted, fontFamily: 'monospace'),
                      ),
                      if (e.reason != null && e.reason!.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          e.reason!,
                          style: TextStyle(fontSize: 12, color: muted, height: 1.4),
                        ),
                      ],
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------- lifecycle -----

  Future<void> _transfer() async {
    final target = await showModalBottomSheet<Section>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _TransferSheet(
        sections: widget.sections,
        currentSectionId: widget.section.id,
      ),
    );
    if (target == null || !mounted) return;

    final reason = await _askReason(
      context: context,
      title: 'Transfer to ${target.code}?',
      subtitle: 'A new roll number is allocated in the destination and the '
          'source enrolments close as transferred — history is retained.',
      hint: 'e.g. Family relocated, needs the morning shift',
      fieldLabel: 'Reason for the move',
    );
    if (reason == null || !mounted) return;

    await _act(() => widget.repository.transfer(
          studentId: widget.row.studentId,
          toSectionId: target.id,
          carryHistory: true,
          reason: reason,
        ));
  }

  Future<void> _suspend() async {
    final reason = await _askReason(
      context: context,
      title: 'Suspend ${widget.row.name}?',
      subtitle: 'The reason is shown to the student — an unexplained loss of '
          'function is indistinguishable from a fault. Their sessions end '
          'immediately.',
      hint: 'e.g. Repeated absence without notice',
      fieldLabel: 'Reason for the suspension',
    );
    if (reason == null || !mounted) return;

    await _act(() => widget.repository.suspend(
          studentId: widget.row.studentId,
          reason: reason,
        ));
  }

  Future<void> _withdraw() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Withdraw ${widget.row.name}?'),
        content: const Text(
          'The roll number is released for reuse; the registration number and the '
          'enrolment history are retained. Read access to the student\'s own record '
          'keeps working.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final reason = await _askReason(
      context: context,
      title: 'Withdraw ${widget.row.name}',
      subtitle: 'Record why this student is withdrawing. It stays on the record.',
      hint: 'e.g. Left the institute midway through the term',
      fieldLabel: 'Reason for the withdrawal',
    );
    if (reason == null || !mounted) return;

    await _act(() => widget.repository.withdraw(
          studentId: widget.row.studentId,
          reason: reason,
        ));
  }

  Future<void> _reinstate() async {
    final reason = await _askReason(
      context: context,
      title: 'Reinstate ${widget.row.name}?',
      subtitle: 'A suspended student\'s enrolments are restored as they were. A '
          'withdrawn student needs a fresh enrolment decision afterwards.',
      hint: 'Optional — e.g. Suspension appeal accepted',
      fieldLabel: 'Reason (optional)',
      optional: true,
    );
    if (reason == null || !mounted) return;

    await _act(() => widget.repository.reinstate(
          studentId: widget.row.studentId,
          reason: reason.isEmpty ? null : reason,
        ));
  }
}

/// Collects a reason with an explicit confirm — the same shape the server's
/// schemas expect (3–500 characters, per §5.4).
Future<String?> _askReason({
  required BuildContext context,
  required String title,
  required String subtitle,
  required String hint,
  required String fieldLabel,
  bool optional = false,
}) {
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setState) {
        String value = controller.text;
        final valid = optional || value.trim().length >= 3;
        return AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: Theme.of(dialogContext).colorScheme.onSurfaceVariant,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 12),
                AdmissionFormField(
                  label: fieldLabel,
                  value: value,
                  hint: hint,
                  onChanged: (v) => setState(() => controller.text = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: valid ? () => Navigator.of(dialogContext).pop(value.trim()) : null,
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    ),
  );
}

/// Choose the destination section for a transfer — FR-ENR-005/006. The list
/// shows occupancy and gender restriction, because a full section and a
/// restricted one are the two ways a transfer can be refused.
class _TransferSheet extends StatefulWidget {
  const _TransferSheet({required this.sections, required this.currentSectionId});

  final List<Section> sections;
  final String currentSectionId;

  @override
  State<_TransferSheet> createState() => _TransferSheetState();
}

class _TransferSheetState extends State<_TransferSheet> {
  String _targetId = '';

  List<Section> get _targets => widget.sections
      .where((s) => s.id != widget.currentSectionId && s.status != 'ARCHIVED')
      .toList();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Transfer to another section',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'A new roll number is allocated in the destination and the source '
            'enrolments close as transferred — history is retained.',
            style: TextStyle(
              fontSize: 12.5,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 12),
          AdmissionSelectField(
            label: 'Destination',
            value: _targetId,
            hint: 'Choose one',
            options: [
              for (final s in _targets)
                (
                  s.id,
                  '${s.code} · ${s.name}'
                      '${s.isFull ? ' — full' : ' — ${s.placesRemaining} free'}'
                      '${s.genderRestriction != 'MIXED' ? ' · ${s.genderRestriction.toLowerCase()} only' : ''}',
                ),
            ],
            onChanged: (v) => setState(() => _targetId = v),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _targetId.isEmpty
                ? null
                : () => Navigator.of(context)
                    .pop(_targets.where((s) => s.id == _targetId).first),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }
}

/// Bulk operations — FR-OPS-020..026, the mobile equivalent of the web's
/// Bulk screen.
///
/// PREVIEW IS THE DEFAULT PATH, not an optional extra. A bulk transfer is not
/// all-or-nothing: each student's move is atomic in itself and the batch is
/// "as many as could be done". The preview is the way to get it right without
/// acting — the commit button stays disabled until one exists. Bulk withdrawal
/// has no preview endpoint, so it asks for an explicit confirmation instead.
class BulkPage extends StatefulWidget {
  const BulkPage({super.key, required this.api, required this.source, required this.roster});

  final ApiClient api;
  final Section source;
  final List<RosterRow> roster;

  @override
  State<BulkPage> createState() => _BulkPageState();
}

class _BulkPageState extends State<BulkPage> {
  late final EnrolmentRepository _repository;
  late final AcademicRepository _academic;

  List<Section> _sections = const [];
  String _toId = '';
  bool _withdrawMode = false;
  final Set<String> _selected = {};
  final TextEditingController _reason = TextEditingController();
  bool _reasonValid = false;

  BatchReport? _preview;
  BatchReport? _result;
  bool _busy = false;
  ApiException? _error;

  @override
  void initState() {
    super.initState();
    _repository = EnrolmentRepository(api: widget.api);
    _academic = AcademicRepository(api: widget.api);
    _academic.listSections().then<void>((s) {
      if (mounted) setState(() => _sections = s);
    }).catchError((Object _) {});
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  List<RosterRow> get _chosen =>
      widget.roster.where((r) => _selected.contains(r.studentId)).toList();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final chosen = _chosen;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Bulk operations'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              'Doing to many students what an administrator would otherwise do '
              'many times. Each student goes through the ordinary operation, so '
              'every rule — capacity, gender restriction, archived sections — '
              'still applies.',
              style: TextStyle(fontSize: 12.5, color: muted, height: 1.5),
            ),
            const SizedBox(height: 14),
            if (_error != null) ...[
              AppAlert(
                title: 'That did not work',
                message: _error!.message,
                reference: _error!.reference,
                details: serverDetailLines(_error!),
              ),
              const SizedBox(height: 12),
            ],
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  label: Text('Move'),
                  icon: Icon(Icons.swap_horiz, size: 16),
                ),
                ButtonSegment(
                  value: true,
                  label: Text('Withdraw'),
                  icon: Icon(Icons.logout_rounded, size: 16),
                ),
              ],
              selected: {_withdrawMode},
              onSelectionChanged: (v) => setState(() {
                _withdrawMode = v.first;
                _preview = null;
                _result = null;
              }),
            ),
            const SizedBox(height: 12),
            Text(
              '${widget.roster.length} ${widget.roster.length == 1 ? 'student' : 'students'}'
              ' in ${widget.source.code} — choose who:',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
            const SizedBox(height: 6),
            if (widget.roster.isEmpty)
              const _EmptyHint(
                'No students in this section — there is nothing to move or withdraw.',
              )
            else
              for (final row in widget.roster)
                CheckboxListTile(
                  value: _selected.contains(row.studentId),
                  onChanged: (v) => setState(() {
                    if (v == true) {
                      _selected.add(row.studentId);
                    } else {
                      _selected.remove(row.studentId);
                    }
                    _preview = null;
                    _result = null;
                  }),
                  title: Text(row.name, style: const TextStyle(fontSize: 13.5)),
                  subtitle: Text(
                    '${row.registrationNo} · roll ${row.rollNo ?? '—'}',
                    style: const TextStyle(fontSize: 11.5, fontFamily: 'monospace'),
                  ),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                ),
            if (!_withdrawMode) ...[
              const SizedBox(height: 12),
              AdmissionSelectField(
                label: 'Move to',
                value: _toId,
                hint: 'Choose one',
                options: [
                  for (final s in _sections)
                    if (s.id != widget.source.id && s.status != 'ARCHIVED')
                      (
                        s.id,
                        '${s.code} · ${s.name}'
                            '${s.isFull ? ' — full' : ' — ${s.placesRemaining} free'}',
                      ),
                ],
                onChanged: (v) => setState(() {
                  _toId = v;
                  _preview = null;
                  _result = null;
                }),
              ),
            ],
            const SizedBox(height: 12),
            AdmissionFormField(
              label: _withdrawMode ? 'Reason' : 'Reason for the move',
              value: _reason.text,
              hint: 'At least 10 characters — it is recorded against every student',
              onChanged: (v) {
                _reason.text = v;
                final valid = v.trim().length >= 10;
                if (valid != _reasonValid) setState(() => _reasonValid = valid);
              },
            ),
            const SizedBox(height: 14),
            if (_preview != null && _result == null) ...[
              _ReportCard(report: _preview!, isPreview: true),
              const SizedBox(height: 12),
            ],
            if (_result != null) ...[
              _ReportCard(report: _result!, isPreview: false),
              const SizedBox(height: 12),
            ],
            if (!_withdrawMode)
              OutlinedButton.icon(
                onPressed:
                    _busy || chosen.isEmpty || _toId.isEmpty || !_reasonValid
                        ? null
                        : () => _previewBatch(),
                icon: const Icon(Icons.visibility_outlined, size: 18),
                label: const Text('Preview the move'),
              ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _busy || chosen.isEmpty || !_reasonValid
                  ? null
                  : _withdrawMode
                      ? () => _commitWithdraw()
                      : _preview == null
                          ? null
                          : () => _commitMove(),
              icon: Icon(
                _withdrawMode ? Icons.logout_rounded : Icons.check_rounded,
                size: 18,
              ),
              label: Text(
                _withdrawMode
                    ? 'Withdraw ${chosen.length} ${chosen.length == 1 ? 'student' : 'students'}'
                    : 'Move ${chosen.length} ${chosen.length == 1 ? 'student' : 'students'}',
              ),
            ),
            if (!_withdrawMode && chosen.isNotEmpty && _preview == null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Preview first — this is not all-or-nothing, so know what will '
                  'go through before acting.',
                  style: TextStyle(fontSize: 12, color: muted),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _previewBatch() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final preview = await _repository.bulkTransferPreview(
        studentIds: [for (final r in _chosen) r.studentId],
        toSectionId: _toId,
      );
      if (!mounted) return;
      setState(() {
        _preview = preview;
        _result = null;
        _busy = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  Future<BatchReport?> _confirmAndCommit({
    required String title,
    required String message,
    required Future<BatchReport> Function() work,
  }) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return null;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final report = await work();
      if (!mounted) return report;
      setState(() {
        _result = report;
        _preview = null;
        _busy = false;
      });
      return report;
    } on ApiException catch (error) {
      if (!mounted) return null;
      setState(() {
        _busy = false;
        _error = error;
      });
      return null;
    }
  }

  Future<void> _commitMove() {
    return _confirmAndCommit(
      title: 'Move them?',
      message: '${_chosen.length} ${_chosen.length == 1 ? 'student is' : 'students are'} '
          'about to move. Each is a separate ordinary transfer — the report will '
          'list anything that did not go through, first.',
      work: () => _repository.bulkTransfer(
        studentIds: [for (final r in _chosen) r.studentId],
        toSectionId: _toId,
        reason: _reason.text.trim(),
      ),
    ).then((_) {});
  }

  Future<void> _commitWithdraw() {
    return _confirmAndCommit(
      title: 'Withdraw them?',
      message: '${_chosen.length} ${_chosen.length == 1 ? 'student is' : 'students are'} '
          'about to be withdrawn. Roll numbers are released; registration numbers '
          'and histories are retained. The report will list anything that did not '
          'go through, first.',
      work: () => _repository.bulkWithdraw(
        studentIds: [for (final r in _chosen) r.studentId],
        reason: _reason.text.trim(),
      ),
    ).then((_) {});
  }
}

/// The server's report, in the server's words — failures first, because the
/// rows needing attention should not sit below fifty that worked.
class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report, required this.isPreview});

  final BatchReport report;
  final bool isPreview;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final failures = [
      for (final r in report.rows)
        if (r.outcome == 'FAILED' || r.outcome == 'SKIPPED') r,
    ];

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isPreview ? 'Preview' : 'Result',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 2),
          Text(report.summary, style: TextStyle(fontSize: 13, color: muted, height: 1.4)),
          if (report.sectionName != null) ...[
            const SizedBox(height: 2),
            Text(
              '${report.sectionName} · ${report.placesRemaining ?? 0} '
              '${report.placesRemaining == 1 ? 'place' : 'places'} remaining',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],
          if (failures.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              '${failures.length} ${failures.length == 1 ? 'row' : 'rows'} did not go '
              'through',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            for (final f in failures.take(8))
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Icon(
                        f.outcome == 'FAILED'
                            ? Icons.error_outline
                            : Icons.skip_next_rounded,
                        size: 15,
                        color: dark ? AppColorsDark.warn : AppColors.warn,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${f.name ?? '—'}: ${f.message ?? ''}',
                        style: TextStyle(fontSize: 12, color: muted, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}