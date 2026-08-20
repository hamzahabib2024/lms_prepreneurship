import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/academic_repository.dart';
import '../data/models/subject.dart';

/// Subjects — the catalogue every section offers from. SRS §13.6, FR-CRS-015.
///
/// A subject is created once, without a deployment; a section offers it
/// afterwards from the Sections screen. The server enforces who may create
/// (FR-CRS-015) — this screen simply stops offering the button to somebody
/// who would be refused.
class SubjectsPage extends StatefulWidget {
  const SubjectsPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<SubjectsPage> createState() => _SubjectsPageState();
}

class _SubjectsPageState extends State<SubjectsPage> {
  late final AcademicRepository _repository;
  late final bool _mayEdit;

  List<Subject> _rows = const [];
  bool _loading = true;
  ApiException? _error;
  String? _note;

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
      final rows = await _repository.listSubjects();
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

  Future<void> _newSubject() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => _SubjectForm(repository: _repository),
    );
    if (created == true && mounted) {
      setState(() => _note = 'Subject created.');
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Subjects'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
        actions: [
          if (_mayEdit)
            IconButton(
              onPressed: () => _newSubject(),
              icon: const Icon(Icons.add),
              tooltip: 'New subject',
            ),
        ],
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
                    '${_rows.length} ${_rows.length == 1 ? 'subject' : 'subjects'} in the catalogue',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                  const SizedBox(height: 8),
                  if (_rows.isEmpty)
                    Text(
                      'No subjects yet. A subject is created once — a section '
                      'offers it afterwards.',
                      style: TextStyle(
                        fontSize: 13.5,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        height: 1.5,
                      ),
                    )
                  else
                    for (final s in _rows)
                      _SubjectCard(subject: s),
                  const SizedBox(height: 16),
                  if (_mayEdit)
                    OutlinedButton.icon(
                      onPressed: () => _newSubject(),
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('New subject'),
                    ),
                ],
              ),
      ),
    );
  }
}

class _SubjectCard extends StatelessWidget {
  const _SubjectCard({required this.subject});

  final Subject subject;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final s = subject;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: dark ? AppColorsDark.brand050 : AppColors.brand050,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Text(
              s.code,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                fontFamily: 'monospace',
                letterSpacing: 0.4,
                color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  s.name,
                  style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                ),
                if (s.credits != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    '${s.credits} ${s.credits == 1 ? 'credit' : 'credits'}',
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ],
                if (s.description != null && s.description!.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    s.description!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: muted, height: 1.4),
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

/// FR-CRS-015 — create a subject without a deployment.
///
/// The code charset mirrors the server's: 2–10 letters/digits, entered
/// uppercase so the created row is what the author saw.
class _SubjectForm extends StatefulWidget {
  const _SubjectForm({required this.repository});

  final AcademicRepository repository;

  @override
  State<_SubjectForm> createState() => _SubjectFormState();
}

class _SubjectFormState extends State<_SubjectForm> {
  String _name = '';
  String _code = '';
  String _description = '';
  String _credits = '';
  bool _busy = false;
  ApiException? _error;

  bool get _canSave {
    final code = _code.trim().toUpperCase();
    final credits = int.tryParse(_credits.trim());
    return _name.trim().length >= 2 &&
        RegExp(r'^[A-Z0-9]{2,10}$').hasMatch(code) &&
        (credits == null || (_credits.trim().isNotEmpty && credits >= 1 && credits <= 20));
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.createSubject(
        name: _name.trim(),
        code: _code.trim().toUpperCase(),
        description: _description.trim().isEmpty ? null : _description.trim(),
        credits: _credits.trim().isEmpty ? null : int.tryParse(_credits.trim()),
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

    // A keyboard-aware, scrollable sheet: the whole form lives in a SafeArea,
    // the scroll viewport shrinks by the keyboard inset so the submit button
    // is always reachable above it, and the content sizes the sheet itself —
    // it scrolls instead of being pushed off a small screen.
    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          6,
          20,
          MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Create a subject',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'A subject is created once; a section offers it afterwards. '
                'The code can never change later.',
                style: TextStyle(fontSize: 12.5, color: muted, height: 1.5),
              ),
              const SizedBox(height: 18),
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
                label: 'Name',
                value: _name,
                hint: 'Digital Marketing',
                onChanged: (v) => setState(() => _name = v),
              ),
              const SizedBox(height: 20),
              AdmissionFormField(
                label: 'Code',
                value: _code,
                hint: 'DM — letters and digits only',
                onChanged: (v) => setState(() => _code = v.toUpperCase()),
              ),
              const SizedBox(height: 20),
              AdmissionFormField(
                label: 'Credits (optional)',
                value: _credits,
                hint: '3',
                keyboardType: TextInputType.number,
                onChanged: (v) => setState(() => _credits = v),
              ),
              const SizedBox(height: 20),
              AdmissionFormField(
                label: 'Description (optional)',
                value: _description,
                hint: 'What the subject is about',
                maxLines: 3,
                onChanged: (v) => setState(() => _description = v),
              ),
              const SizedBox(height: 22),
              FilledButton(
                onPressed: _busy || !_canSave ? null : () => _submit(),
                // A ghosted state that stays legible (muted on surface-2) so
                // the disabled button reads as unfilled, not invisible.
                style: FilledButton.styleFrom(
                  disabledBackgroundColor:
                      dark ? AppColorsDark.surface2 : AppColors.surface2,
                  disabledForegroundColor:
                      dark ? AppColorsDark.muted : AppColors.muted,
                ),
                child: _busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : const Text('Create subject'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}