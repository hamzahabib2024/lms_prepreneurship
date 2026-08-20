import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/academic_repository.dart';
import '../data/models/section.dart';
import '../data/models/structure.dart';
import '../data/models/subject.dart';

const _shifts = ['MORNING', 'AFTERNOON', 'EVENING', 'WEEKEND'];
const _restrictions = ['MIXED', 'MALE', 'FEMALE'];
const _modes = ['ONLINE', 'HYBRID', 'ON_CAMPUS'];
const _statuses = ['PLANNED', 'ACTIVE', 'CLOSED_FOR_ADMISSION', 'ARCHIVED'];

String pretty(String s) => s.toLowerCase().replaceAll('_', ' ');

/// Sections — the mobile equivalent of the web's Sections screen.
///
/// A section is a class group — one shift, one capacity, one register. The
/// list is already scoped by the server, so a teacher sees their own sections
/// here without this screen asking for a filter. There is no delete
/// (FR-CRS-013, BR-DAT-04): a section that has ever held an enrolment is
/// archived, never removed.
class SectionsPage extends StatefulWidget {
  const SectionsPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<SectionsPage> createState() => _SectionsPageState();
}

class _SectionsPageState extends State<SectionsPage> {
  late final AcademicRepository _repository;
  late final bool _mayEdit;

  List<Section> _rows = const [];
  List<Batch> _batches = const [];
  List<Subject> _subjects = const [];
  bool _loading = true;
  bool _busy = false;
  ApiException? _error;
  String? _note;

  String _batchFilter = '';

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _mayEdit = widget.user.isAdmin || widget.user.isSuperAdmin;
    _load();
    _repository.listBatches().then<void>((b) {
      if (mounted) setState(() => _batches = b);
    }).catchError((Object _) {});
    _repository.listSubjects().then<void>((s) {
      if (mounted) setState(() => _subjects = s);
    }).catchError((Object _) {});
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _repository.listSections(
        batchId: _batchFilter.isEmpty ? null : _batchFilter,
      );
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

  Future<void> _run(Future<void> Function() work, String said) async {
    setState(() {
      _busy = true;
      _error = null;
      _note = null;
    });
    try {
      await work();
      if (!mounted) return;
      setState(() => _note = said);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // -------------------------------------------------------------- creating ----

  Future<void> _newSection() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _SectionForm(
        repository: _repository,
        batches: _batches,
      ),
    );
    if (created == true && mounted) {
      setState(() => _note = 'Section created.');
      await _load();
    }
  }

  Future<void> _editSection(Section section) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _SectionForm(repository: _repository, section: section),
    );
    if (changed == true && mounted) {
      setState(() => _note = 'Section updated.');
      await _load();
    }
  }

  Future<void> _archive(Section section) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Archive ${section.code}?'),
        content: const Text(
          'It stops accepting enrolments and leaves the active lists. Nothing is '
          'deleted — its attendance, marks and fees stay readable.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Archive'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(() => _repository.archiveSection(section.id), '${section.code} archived.');
  }

  // ------------------------------------------------------------- offerings ----

  Future<void> _openSubjects(Section section) async {
    final sheet = showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => AllOfferingsSheet(
        section: section,
        repository: _repository,
        subjects: _subjects,
        mayEdit: _mayEdit,
      ),
    );
    await sheet;
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sections'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          if (_mayEdit)
            IconButton(
              onPressed: () => _newSection(),
              icon: const Icon(Icons.add),
              tooltip: 'New section',
            ),
        ],
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
                  if (_batches.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AdmissionSelectField(
                        label: 'Batch',
                        value: _batchFilter,
                        hint: 'All batches',
                        options: [
                          ('', 'All batches'),
                          for (final b in _batches)
                            (b.id, '${b.session.code} · ${b.name}'),
                        ],
                        onChanged: (v) {
                          setState(() => _batchFilter = v);
                          _load();
                        },
                      ),
                    ),
                  Text(
                    '${_rows.length} ${_rows.length == 1 ? 'section' : 'sections'} visible to you',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                  const SizedBox(height: 8),
                  if (_rows.isEmpty)
                    _EmptyHint(
                      _batchFilter.isEmpty
                          ? 'No sections yet. A section is a class group; create one '
                              'with the button above.'
                          : 'No sections in that batch.',
                    )
                  else
                    for (final s in _rows)
                      _SectionCard(
                        section: s,
                        mayEdit: _mayEdit,
                        busy: _busy,
                        onOpen: () => _openSubjects(s),
                        onEdit: _mayEdit ? () => _editSection(s) : null,
                        onArchive:
                            _mayEdit && s.status != 'ARCHIVED' ? () => _archive(s) : null,
                      ),
                  const SizedBox(height: 16),
                  if (_mayEdit)
                    OutlinedButton.icon(
                      onPressed: () => _newSection(),
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('New section'),
                    ),
                ],
              ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.section,
    required this.mayEdit,
    required this.busy,
    required this.onOpen,
    this.onEdit,
    this.onArchive,
  });

  final Section section;
  final bool mayEdit;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback? onEdit;
  final VoidCallback? onArchive;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final s = section;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Material(
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
                          Row(
                            children: [
                              Text(
                                s.code,
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  fontFamily: 'monospace',
                                  letterSpacing: 0.4,
                                  color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(s.name, overflow: TextOverflow.ellipsis),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            [
                              if (s.sessionCode != null)
                                '${s.sessionCode} · ${s.batchCode ?? ''}',
                              pretty(s.shift),
                              pretty(s.genderRestriction),
                            ].join(' · '),
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        // FR-CRS-010 — occupancy wherever a section appears.
                        s.isFull
                            ? const Pill(text: 'full', kind: PillKind.warn)
                            : Pill(text: '${s.placesRemaining} free'),
                        const SizedBox(height: 6),
                        Pill(
                          text: pretty(s.status),
                          kind: s.status == 'ACTIVE' ? PillKind.ok : PillKind.neutral,
                        ),
                      ],
                    ),
                    Icon(Icons.chevron_right_rounded, color: muted),
                  ],
                ),
              ),
            ),
          ),
          // Enrolled / capacity, below the row rather than invisible beside it.
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
            color: dark ? AppColorsDark.surface2 : AppColors.surface2,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${s.enrolledCount} of ${s.capacity} enrolled · '
                    '${s.subjectCount} ${s.subjectCount == 1 ? 'subject' : 'subjects'}',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ),
                TextButton(
                  onPressed: onOpen,
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                  child: Text('Subjects ${s.subjectCount > 0 ? '(${s.subjectCount})' : ''}'),
                ),
                if (mayEdit) ...[
                  IconButton(
                    onPressed: busy ? null : onEdit,
                    icon: const Icon(Icons.edit_outlined, size: 17),
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Edit',
                  ),
                  IconButton(
                    onPressed: busy ? null : onArchive,
                    icon: const Icon(Icons.archive_outlined, size: 17),
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Archive',
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
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

/// A submit footer shared by the section forms.
class SubmitFooter extends StatelessWidget {
  const SubmitFooter({
    super.key,
    required this.busy,
    required this.enabled,
    required this.onSubmit,
    this.submitLabel = 'Save',
  });

  final bool busy;
  final bool enabled;
  final VoidCallback onSubmit;
  final String submitLabel;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy || !enabled ? null : onSubmit,
      child: busy
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
              ),
            )
          : Text(submitLabel),
    );
  }
}

/// Create a section, or edit the shape of one that exists.
///
/// The gender restriction is deliberately not offered on edit: FR-CRS-009 is
/// absolute once students are admitted, and there is no override anywhere.
class _SectionForm extends StatefulWidget {
  const _SectionForm({required this.repository, this.batches = const [], this.section});

  final AcademicRepository repository;
  final List<Batch> batches;
  final Section? section;

  bool get isEdit => section != null;

  @override
  State<_SectionForm> createState() => _SectionFormState();
}

class _SectionFormState extends State<_SectionForm> {
  late final TextEditingController _code =
      TextEditingController(text: widget.section?.code ?? '');
  late final TextEditingController _name =
      TextEditingController(text: widget.section?.name ?? '');
  late final TextEditingController _capacity =
      TextEditingController(text: widget.section?.capacity.toString() ?? '30');
  late String _batchId = widget.section?.batchCode == null ? '' : '';
  late String _shift = widget.section?.shift ?? 'MORNING';
  late String _restriction = widget.section?.genderRestriction ?? 'MIXED';
  late String _mode = widget.section?.deliveryMode ?? 'ONLINE';
  late String _status = widget.section?.status ?? 'PLANNED';
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _capacity.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.isEdit) {
        await widget.repository.updateSection(
          widget.section!.id,
          name: _name.text.trim(),
          capacity: int.tryParse(_capacity.text.trim()),
          status: _status,
          shift: _shift,
        );
      } else {
        await widget.repository.createSection(
          batchId: _batchId,
          code: _code.text.trim().toUpperCase(),
          name: _name.text.trim(),
          capacity: int.tryParse(_capacity.text.trim()) ?? 30,
          genderRestriction: _restriction,
          shift: _shift,
          deliveryMode: _mode,
        );
      }
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

  bool get _canSave {
    if (widget.isEdit) return _name.text.trim().length >= 3;
    return _batchId.isNotEmpty &&
        _code.text.trim().length >= 3 &&
        _name.text.trim().length >= 3 &&
        (int.tryParse(_capacity.text.trim()) ?? 0) > 0;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: SingleChildScrollView(
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
            if (!widget.isEdit) ...[
              AdmissionSelectField(
                label: 'Batch',
                value: _batchId,
                hint: 'Choose one',
                options: [
                  for (final b in widget.batches)
                    (
                      b.id,
                      '${b.session.programme.code} · ${b.session.code} · ${b.name}',
                    ),
                ],
                onChanged: (v) => setState(() => _batchId = v),
              ),
              const SizedBox(height: 12),
              AdmissionFormField(
                label: 'Code',
                value: _code.text,
                hint: 'SP26-GD-MOR-A — unique, letters/digits/hyphens',
                onChanged: (v) => setState(() => _code.text = v.toUpperCase()),
              ),
              const SizedBox(height: 12),
            ],
            AdmissionFormField(
              label: 'Name',
              value: _name.text,
              hint: 'Graphic Designing — Morning A',
              onChanged: (v) => setState(() => _name.text = v),
            ),
            const SizedBox(height: 12),
            AdmissionFormField(
              label: 'Capacity',
              value: _capacity.text,
              hint: '30',
              keyboardType: TextInputType.number,
              onChanged: (v) => setState(() => _capacity.text = v),
            ),
            const SizedBox(height: 12),
            AdmissionSelectField(
              label: 'Shift',
              value: _shift,
              hint: 'Choose…',
              options: [for (final s in _shifts) (s, pretty(s))],
              onChanged: (v) => setState(() => _shift = v),
            ),
            if (!widget.isEdit) ...[
              const SizedBox(height: 12),
              AdmissionSelectField(
                label: 'Admits',
                value: _restriction,
                hint: 'Choose…',
                options: [for (final r in _restrictions) (r, pretty(r))],
                onChanged: (v) => setState(() => _restriction = v),
              ),
              // FR-CRS-009 — absolute once students are admitted, and there
              // is no override anywhere in the System.
              const SizedBox(height: 4),
              Text(
                'Cannot be relaxed once students are admitted.',
                style: TextStyle(
                  fontSize: 12,
                  color: darkMuted(context),
                ),
              ),
              const SizedBox(height: 12),
              AdmissionSelectField(
                label: 'Delivery',
                value: _mode,
                hint: 'Choose…',
                options: [for (final m in _modes) (m, pretty(m))],
                onChanged: (v) => setState(() => _mode = v),
              ),
            ],
            if (widget.isEdit) ...[
              const SizedBox(height: 12),
              AdmissionSelectField(
                label: 'Status',
                value: _status,
                hint: 'Choose…',
                options: [for (final s in _statuses) (s, pretty(s))],
                onChanged: (v) => setState(() => _status = v),
              ),
            ],
            const SizedBox(height: 16),
            SubmitFooter(
              busy: _busy,
              enabled: _canSave,
              submitLabel: widget.isEdit ? 'Save' : 'Create section',
              onSubmit: () => _submit(),
            ),
            if (!widget.isEdit && widget.batches.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 10),
                child: Text(
                  'No batch exists yet. Create a term and a batch under Academic '
                  'structure first — a section has to belong to one.',
                  style: TextStyle(fontSize: 12.5),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Color darkMuted(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
          ? AppColorsDark.muted
          : AppColors.muted;
}

/// The subjects offered to one section, with the teachers on them.
///
/// FR-CRS-026 — an uncovered class shows "no teacher", so the Institute
/// notices it rather than its students.
class AllOfferingsSheet extends StatefulWidget {
  const AllOfferingsSheet({
    super.key,
    required this.section,
    required this.repository,
    required this.subjects,
    required this.mayEdit,
  });

  final Section section;
  final AcademicRepository repository;
  final List<Subject> subjects;
  final bool mayEdit;

  @override
  State<AllOfferingsSheet> createState() => _AllOfferingsSheetState();
}

class _AllOfferingsSheetState extends State<AllOfferingsSheet> {
  List<Offering>? _offerings;
  ApiException? _error;
  bool _busy = false;
  String _newSubjectId = '';
  bool _compulsory = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final offerings = await widget.repository.listOfferings(widget.section.id);
      if (!mounted) return;
      setState(() => _offerings = offerings);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<void> _add() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.offerSubject(
        sectionId: widget.section.id,
        subjectId: _newSubjectId,
        isCompulsory: _compulsory,
      );
      if (!mounted) return;
      setState(() {
        _newSubjectId = '';
        _busy = false;
      });
      await _load();
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
    final s = widget.section;

    final offerings = _offerings;
    final offeredIds = offerings?.map((o) => o.subjectId).toSet() ?? const <String>{};
    final addable = widget.subjects.where((x) => !offeredIds.contains(x.id)).toList();

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Subjects in ${s.code}', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            '${s.name} · ${s.sessionCode ?? ''} ${s.batchCode ?? ''}'.trim(),
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 12),
          if (_error != null) ...[
            AppAlert(
              title: 'That did not work',
              message: _error!.message,
              reference: _error!.reference,
              details: serverDetailLines(_error!),
            ),
            const SizedBox(height: 12),
          ],
          if (offerings == null)
            const Skeleton(lines: 3)
          else if (offerings.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                'No subjects yet. A section with no subjects has nothing to teach, '
                'mark or attend.',
                style: TextStyle(fontSize: 13.5, color: muted),
              ),
            )
          else
            for (final o in offerings)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${o.subjectCode}  ${o.subjectName}',
                            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '${o.isCompulsory ? 'compulsory' : 'elective'} · '
                            '${o.enrolled} enrolled',
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                          const SizedBox(height: 4),
                          if (o.hasTeacher)
                            Text(
                              'Teacher: ${o.teacherNames.join(', ')}',
                              style: TextStyle(fontSize: 12, color: muted),
                            )
                          else
                            const Pill(text: 'no teacher', kind: PillKind.warn),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          if (widget.mayEdit && addable.isNotEmpty) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(
                  child: AdmissionSelectField(
                    label: 'Add a subject',
                    value: _newSubjectId,
                    hint: 'Choose one',
                    options: [
                      for (final sub in addable) (sub.id, '${sub.code} — ${sub.name}'),
                    ],
                    onChanged: (v) => setState(() => _newSubjectId = v),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: AdmissionSelectField(
                    label: 'Required',
                    value: _compulsory ? 'yes' : 'no',
                    hint: 'Choose…',
                    options: const [
                      ('yes', 'Compulsory'),
                      ('no', 'Elective'),
                    ],
                    onChanged: (v) =>
                        setState(() => _compulsory = v == 'yes'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _busy || _newSubjectId.isEmpty ? null : () => _add(),
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Text('Add subject'),
            ),
          ] else if (widget.mayEdit && offerings != null && offerings.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'Every subject is already offered in this section.',
                style: TextStyle(fontSize: 12.5, color: muted),
              ),
            ),
        ],
      ),
    );
  }
}