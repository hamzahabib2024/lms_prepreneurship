import 'package:flutter/material.dart';

import '../../../core/formats.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/academic_repository.dart';
import '../data/models/structure.dart';

const _sessionStatuses = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

/// Shared code-column typography — letters, digits and hyphens, monospace.
const _codeStyle = TextStyle(
  fontSize: 13,
  fontWeight: FontWeight.w700,
  fontFamily: 'monospace',
  letterSpacing: 0.4,
);

/// Academic structure — the mobile equivalent of the web's Structure screen.
///
/// Programmes hold terms; terms hold batches; batches hold sections. The
/// order on screen is the order of the dependency: a term cannot exist
/// without a programme, a batch without a term. Editing is offered only to an
/// administrator, exactly as the web offers it; a teacher reads the same
/// lists and can no more write than the web lets them. The server refuses
/// anything the role does not hold (ARC-003).
class StructurePage extends StatefulWidget {
  const StructurePage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<StructurePage> createState() => _StructurePageState();
}

class _StructurePageState extends State<StructurePage> {
  late final AcademicRepository _repository;
  late final bool _mayEdit;

  List<Programme> _programmes = const [];
  List<AcademicSession> _sessions = const [];
  List<Batch> _batches = const [];
  bool _loading = true;
  ApiException? _error;
  String? _note;

  /// Which term the batch list is filtered to. '' is all of them.
  String _termFilter = '';

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _mayEdit = widget.user.isAdmin || widget.user.isSuperAdmin;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait<Object>([
        _repository.listProgrammes(),
        _repository.listSessions(),
        _repository.listBatches(),
      ]);
      if (!mounted) return;
      setState(() {
        _programmes = results[0] as List<Programme>;
        _sessions = results[1] as List<AcademicSession>;
        _batches = results[2] as List<Batch>;
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

  Future<T?> _sheet<T>({
    required String title,
    required WidgetBuilder builder,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title, style: Theme.of(sheetContext).textTheme.titleMedium),
              const SizedBox(height: 14),
              Flexible(child: SingleChildScrollView(child: builder(sheetContext))),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _addProgramme() async {
    final created = await _sheet<bool>(
      title: 'Add a programme',
      builder: (_) => _ProgrammeForm(repository: _repository),
    );
    if (created == true && mounted) {
      setState(() => _note = 'Programme created. A term can be added to it now.');
      await _load();
    }
  }

  Future<void> _addSession() async {
    final created = await _sheet<bool>(
      title: 'Add a term',
      builder: (_) => _SessionForm(repository: _repository, programmes: _programmes),
    );
    if (created == true && mounted) {
      setState(() => _note = 'Term created.');
      await _load();
    }
  }

  Future<void> _editSession(AcademicSession session) async {
    final changed = await _sheet<bool>(
      title: 'Edit ${session.code}',
      builder: (_) => _SessionForm(
        repository: _repository,
        programmes: _programmes,
        session: session,
      ),
    );
    if (changed == true && mounted) {
      setState(() => _note = 'Term updated.');
      await _load();
    }
  }

  Future<void> _addBatch() async {
    final created = await _sheet<bool>(
      title: 'Add a batch',
      builder: (_) => _BatchForm(
        repository: _repository,
        sessions: _sessions,
      ),
    );
    if (created == true && mounted) setState(() => _note = 'Batch created.');
  }

  Future<void> _editBatch(Batch batch) async {
    final changed = await _sheet<bool>(
      title: 'Edit ${batch.name}',
      builder: (_) => _BatchForm(repository: _repository, batch: batch),
    );
    if (changed == true && mounted) {
      setState(() => _note = 'Batch updated.');
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Academic structure'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          if (_mayEdit)
            PopupMenuButton<String>(
              tooltip: 'Add',
              icon: const Icon(Icons.add),
              onSelected: (v) {
                if (v == 'programme') _addProgramme();
                if (v == 'term') _addSession();
                if (v == 'batch') _addBatch();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'programme', child: Text('Add a programme')),
                PopupMenuItem(value: 'term', child: Text('Add a term')),
                PopupMenuItem(value: 'batch', child: Text('Add a batch')),
              ],
            ),
        ],
      ),
      body: SafeArea(
        child: _loading && _sessions.isEmpty
            ? const SingleChildScrollView(
                padding: EdgeInsets.all(20),
                child: SkeletonCards(count: 3),
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

                  // --------------------------------------------------- programmes
                  _SectionHeader(title: 'Programmes', count: _programmes.length),
                  if (_programmes.isEmpty)
                    const _EmptyHint(
                      'No programmes yet. A programme begins the chain — then its '
                      'terms, their batches, the batches\' sections.',
                    )
                  else
                    for (final p in _programmes)
                      _Card(
                        child: Row(
                          children: [
                            _code(context, p.code),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(p.name),
                                  const SizedBox(height: 2),
                                  Text(
                                    [
                                      if (p.durationWeeks != null)
                                        '${p.durationWeeks} weeks',
                                      '${p.sessions} ${p.sessions == 1 ? 'term' : 'terms'}',
                                    ].join(' · '),
                                    style: TextStyle(fontSize: 12, color: muted),
                                  ),
                                  if (p.description != null && p.description!.isNotEmpty)
                                    Text(
                                      p.description!,
                                      style: TextStyle(fontSize: 12, color: muted),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                  const SizedBox(height: 18),

                  // ----------------------------------------------------------- terms
                  _SectionHeader(title: 'Terms', count: _sessions.length),
                  if (_sessions.isEmpty)
                    const _EmptyHint(
                      'No terms yet. A term is an intake — Spring 2026, Fall 2026. '
                      'Everything else hangs off one.',
                    )
                  else
                    for (final s in _sessions)
                      _Card(
                        onTap: _mayEdit ? () => _editSession(s) : null,
                        child: Row(
                          children: [
                            _code(context, s.code),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(s.name),
                                  const SizedBox(height: 2),
                                  Text(
                                    [
                                      s.programme.code,
                                      if (s.startDate != null && s.endDate != null)
                                        '${Formats.shortDate(s.startDate!)} → '
                                            '${Formats.shortDate(s.endDate!)}',
                                      '${s.batches} ${s.batches == 1 ? 'batch' : 'batches'}',
                                    ].join(' · '),
                                    style: TextStyle(fontSize: 12, color: muted),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Pill(
                              text: s.status.toLowerCase(),
                              kind: s.status == 'ACTIVE' ? PillKind.ok : PillKind.neutral,
                            ),
                          ],
                        ),
                      ),
                  const SizedBox(height: 18),

                  // --------------------------------------------------------- batches
                  _SectionHeader(title: 'Batches', count: _batches.length),
                  if (_batches.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AdmissionSelectField(
                        label: 'Term',
                        value: _termFilter,
                        hint: 'All terms',
                        options: [
                          ('', 'All terms'),
                          for (final s in _sessions) (s.id, '${s.code} — ${s.name}'),
                        ],
                        onChanged: (v) => setState(() => _termFilter = v),
                      ),
                    ),
                  if (_visibleBatches.isEmpty)
                    _EmptyHint(
                      _termFilter.isEmpty
                          ? 'No batches yet. A batch groups the sections that run '
                              'together — one delivery pattern, one intake.'
                          : 'No batches in that term.',
                    )
                  else
                    for (final b in _visibleBatches)
                      _Card(
                        onTap: _mayEdit ? () => _editBatch(b) : null,
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(b.name),
                                  const SizedBox(height: 2),
                                  Text(
                                    '${b.session.programme.code} · ${b.session.code} · '
                                    '${b.sections} ${b.sections == 1 ? 'section' : 'sections'}',
                                    style: TextStyle(fontSize: 12, color: muted),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            Pill(text: b.deliveryPattern),
                          ],
                        ),
                      ),
                ],
              ),
      ),
    );
  }

  List<Batch> get _visibleBatches => _termFilter.isEmpty
      ? _batches
      : _batches.where((b) => b.session.id == _termFilter).toList();

  /// The code column — letters, digits and hyphens, always monospace, in a
  /// fixed-width cell measured against the widest valid code (10 characters).
  /// Codes therefore never change the card's height or push the text that
  /// follows: every programme name starts at the same x whatever the code.
  Widget _code(BuildContext context, String code) => SizedBox(
        width: _codeColumnWidth(context),
        child: Text(
          code,
          maxLines: 1,
          overflow: TextOverflow.clip,
          style: _codeStyle.copyWith(
            color: Theme.of(context).brightness == Brightness.dark
                ? AppColorsDark.brand600
                : AppColors.brand600,
          ),
        ),
      );

  /// The width one 10-character code needs under the real font in use —
  /// measured, not guessed, so it fits any monospace and text scale.
  double _codeColumnWidth(BuildContext context) {
    final painter = TextPainter(
      text: const TextSpan(text: 'MMMMMMMMMM', style: _codeStyle),
      maxLines: 1,
      textDirection: TextDirection.ltr,
      textScaler: MediaQuery.textScalerOf(context),
    )..layout();
    return painter.width;
  }
}

// ------------------------------------------------------------------- pieces ---

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.count});

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        '$title ($count)',
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
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
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: child,
          ),
        ),
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

class _SubmitRow extends StatelessWidget {
  const _SubmitRow({
    required this.busy,
    required this.onSubmit,
    this.enabled = true,
    this.submitLabel = 'Save',
  });

  final bool busy;
  final VoidCallback onSubmit;
  final bool enabled;
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

class _ProgrammeForm extends StatefulWidget {
  const _ProgrammeForm({required this.repository});

  final AcademicRepository repository;

  @override
  State<_ProgrammeForm> createState() => _ProgrammeFormState();
}

class _ProgrammeFormState extends State<_ProgrammeForm> {
  final _name = TextEditingController();
  final _code = TextEditingController();
  final _duration = TextEditingController();
  final _description = TextEditingController();
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    _duration.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.createProgramme(
        name: _name.text.trim(),
        code: _code.text.trim().toUpperCase(),
        durationWeeks: int.tryParse(_duration.text.trim()),
        description: _description.text.trim().isEmpty ? null : _description.text.trim(),
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

  bool get _canSave =>
      _name.text.trim().length >= 3 && _code.text.trim().length >= 2;

  @override
  Widget build(BuildContext context) {
    return Column(
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
        AdmissionFormField(
          label: 'Code',
          value: _code.text,
          hint: 'GD — used in registration numbers, permanent',
          onChanged: (v) => setState(() => _code.text = v.toUpperCase()),
        ),
        const SizedBox(height: 12),
        AdmissionFormField(
          label: 'Name',
          value: _name.text,
          hint: 'Graphic Designing',
          onChanged: (v) => setState(() => _name.text = v),
        ),
        const SizedBox(height: 12),
        AdmissionFormField(
          label: 'Duration (weeks)',
          value: _duration.text,
          hint: '52, optional',
          keyboardType: TextInputType.number,
          onChanged: (v) => setState(() => _duration.text = v),
        ),
        const SizedBox(height: 12),
        AdmissionFormField(
          label: 'Description',
          value: _description.text,
          hint: 'What this programme leads to',
          maxLines: 2,
          onChanged: (v) => setState(() => _description.text = v),
        ),
        const SizedBox(height: 16),
        _SubmitRow(
            busy: _busy,
            enabled: _canSave,
            submitLabel: 'Create programme',
            onSubmit: () => _submit(),
          ),
      ],
    );
  }
}

class _SessionForm extends StatefulWidget {
  const _SessionForm({
    required this.repository,
    required this.programmes,
    this.session,
  });

  final AcademicRepository repository;
  final List<Programme> programmes;
  final AcademicSession? session;

  bool get isEdit => session != null;

  @override
  State<_SessionForm> createState() => _SessionFormState();
}

class _SessionFormState extends State<_SessionForm> {
  late final TextEditingController _name =
      TextEditingController(text: widget.session?.name ?? '');
  late final TextEditingController _code =
      TextEditingController(text: widget.session?.code ?? '');
  late String _programmeId = widget.session?.programme.id ?? '';
  late String _status = widget.session?.status ?? 'PLANNED';
  late DateTime? _startDate = widget.session?.startDate;
  late DateTime? _endDate = widget.session?.endDate;
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _name.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.isEdit) {
        await widget.repository.updateSession(
          widget.session!.id,
          name: _name.text.trim(),
          status: _status,
          startDate: _startDate,
          endDate: _endDate,
        );
      } else {
        await widget.repository.createSession(
          programmeId: _programmeId,
          name: _name.text.trim(),
          code: _code.text.trim().toUpperCase(),
          startDate: _startDate ?? DateTime.now(),
          endDate: _endDate ?? DateTime.now().add(const Duration(days: 90)),
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

  bool get _rangeOk =>
      _startDate == null || _endDate == null || _endDate!.isAfter(_startDate!);

  bool get _canSave =>
      (widget.isEdit || (_programmeId.isNotEmpty && _code.text.trim().length >= 2)) &&
      _name.text.trim().length >= 3 &&
      _rangeOk;

  @override
  Widget build(BuildContext context) {
    return Column(
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
            label: 'Programme',
            value: _programmeId,
            hint: 'Choose one',
            options: [
              for (final p in widget.programmes) (p.id, '${p.code} — ${p.name}'),
            ],
            onChanged: (v) => setState(() => _programmeId = v),
          ),
          const SizedBox(height: 12),
          AdmissionFormField(
            label: 'Code',
            value: _code.text,
            hint: 'SP26 — used in registration numbers, permanent',
            onChanged: (v) => setState(() => _code.text = v.toUpperCase()),
          ),
          const SizedBox(height: 12),
        ],
        AdmissionFormField(
          label: 'Name',
          value: _name.text,
          hint: 'Spring 2026',
          onChanged: (v) => setState(() => _name.text = v),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: AdmissionDateField(
                label: 'Starts',
                value: _startDate,
                hint: 'Choose…',
                firstDate: DateTime(2018),
                lastDate: DateTime(2035),
                onChanged: (v) => setState(() => _startDate = v ?? _startDate),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: AdmissionDateField(
                label: 'Ends',
                value: _endDate,
                hint: 'Choose…',
                firstDate: DateTime(2018),
                lastDate: DateTime(2035),
                onChanged: (v) => setState(() => _endDate = v ?? _endDate),
              ),
            ),
          ],
        ),
        if (!_rangeOk)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'The end date must be after the start date.',
              style: TextStyle(fontSize: 12.5, color: AppColors.error),
            ),
          ),
        if (widget.isEdit) ...[
          const SizedBox(height: 12),
          AdmissionSelectField(
            label: 'Status',
            value: _status,
            hint: 'Choose…',
            options: [for (final s in _sessionStatuses) (s, s.toLowerCase())],
            onChanged: (v) => setState(() => _status = v),
          ),
        ],
        const SizedBox(height: 16),
        _SubmitRow(
          busy: _busy,
          enabled: _canSave,
          submitLabel: widget.isEdit ? 'Save' : 'Create term',
          onSubmit: () => _submit(),
        ),
      ],
    );
  }
}

class _BatchForm extends StatefulWidget {
  const _BatchForm({
    required this.repository,
    this.sessions = const [],
    this.batch,
  });

  final AcademicRepository repository;
  final List<AcademicSession> sessions;
  final Batch? batch;

  bool get isEdit => batch != null;

  @override
  State<_BatchForm> createState() => _BatchFormState();
}

class _BatchFormState extends State<_BatchForm> {
  late final TextEditingController _name =
      TextEditingController(text: widget.batch?.name ?? '');
  late final TextEditingController _pattern =
      TextEditingController(text: widget.batch?.deliveryPattern ?? '');
  late String _sessionId = widget.batch?.session.id ?? '';
  bool _busy = false;
  ApiException? _error;

  @override
  void dispose() {
    _name.dispose();
    _pattern.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.isEdit) {
        await widget.repository.updateBatch(
          widget.batch!.id,
          name: _name.text.trim(),
          deliveryPattern: _pattern.text.trim(),
        );
      } else {
        await widget.repository.createBatch(
          academicSessionId: _sessionId,
          name: _name.text.trim(),
          deliveryPattern: _pattern.text.trim(),
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

  bool get _canSave =>
      (widget.isEdit || _sessionId.isNotEmpty) &&
      _name.text.trim().length >= 3 &&
      _pattern.text.trim().length >= 2;

  @override
  Widget build(BuildContext context) {
    return Column(
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
            label: 'Term',
            value: _sessionId,
            hint: 'Choose one',
            options: [
              for (final s in widget.sessions)
                (s.id, '${s.programme.code} · ${s.code} — ${s.name}'),
            ],
            onChanged: (v) => setState(() => _sessionId = v),
          ),
          // FR-CRS-005 — the reason the server also gives: a batch cannot be
          // added to a term that is already finished or abandoned.
          const SizedBox(height: 12),
        ],
        AdmissionFormField(
          label: 'Name',
          value: _name.text,
          hint: 'Morning intake',
          onChanged: (v) => setState(() => _name.text = v),
        ),
        const SizedBox(height: 12),
        AdmissionFormField(
          label: 'Delivery pattern',
          value: _pattern.text,
          hint: 'Weekday',
          onChanged: (v) => setState(() => _pattern.text = v),
        ),
        const SizedBox(height: 16),
        _SubmitRow(
          busy: _busy,
          enabled: _canSave,
          submitLabel: widget.isEdit ? 'Save' : 'Create batch',
          onSubmit: () => _submit(),
        ),
      ],
    );
  }
}