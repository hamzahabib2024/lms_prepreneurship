import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/academic_repository.dart';
import '../data/models/subject.dart';

/// Course content — SRS §13.6, FR-CRS-027..032.
///
/// A subject's modules, the lessons inside them, and the recordings attached
/// to each. PUBLICATION IS THE THROUGH-LINE: everything starts as a draft
/// (BR-CNT-01) and the state is stated on every row, because the question a
/// teacher is asking is "can my students see this yet".
class ContentPage extends StatefulWidget {
  const ContentPage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<ContentPage> createState() => _ContentPageState();
}

class _ContentPageState extends State<ContentPage> {
  late final AcademicRepository _repository;
  late final bool _mayEdit;

  List<Subject> _subjects = const [];
  String _subjectId = '';
  List<Module>? _modules;
  bool _loading = false;
  bool _busy = false;
  ApiException? _error;

  String _moduleTitle = '';

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _mayEdit = widget.user.isAdmin || widget.user.isSuperAdmin || widget.user.isTeacher;
    _loadSubjects();
  }

  Future<void> _loadSubjects() async {
    try {
      final subjects = await _repository.listSubjects();
      if (!mounted) return;
      setState(() => _subjects = subjects);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    }
  }

  Future<void> _loadTree(String subjectId) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final tree = await _repository.contentTree(subjectId);
      if (!mounted) return;
      setState(() {
        _modules = tree;
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

  Future<void> _addModule() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _repository.createModule(subjectId: _subjectId, title: _moduleTitle.trim());
      if (!mounted) return;
      setState(() => _moduleTitle = '');
      await _loadTree(_subjectId);
      setState(() => _busy = false);
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

    final modules = _modules;
    final chosen = _subjectId.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Modules & lessons'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
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
            if (_subjects.isNotEmpty)
              AdmissionSelectField(
                label: 'Subject',
                value: _subjectId,
                hint: 'Choose one…',
                options: [
                  for (final s in _subjects) (s.id, '${s.code} — ${s.name}'),
                ],
                onChanged: (v) {
                  setState(() {
                    _subjectId = v;
                    _modules = null;
                  });
                  _loadTree(v);
                },
              ),
            const SizedBox(height: 14),
            if (chosen && _loading) const SkeletonCards(count: 2),
            if (chosen && !_loading && modules != null) ...[
              if (_mayEdit)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AdmissionFormField(
                      label: 'New module',
                      value: _moduleTitle,
                      hint: 'Foundations of Design',
                      onChanged: (v) => setState(() => _moduleTitle = v),
                    ),
                    const SizedBox(height: 10),
                    FilledButton(
                      onPressed:
                          _busy || _moduleTitle.trim().length < 2 ? null : () => _addModule(),
                      child: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                              ),
                            )
                          : const Text('Add module'),
                    ),
                    const SizedBox(height: 14),
                  ],
                ),
              if (modules.isEmpty)
                Text(
                  'Nothing here yet. Start with a module — a week, a theme, a '
                  'unit — and put lessons inside it.',
                  style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                )
              else
                for (final m in modules)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _ModuleCard(
                      module: m,
                      mayEdit: _mayEdit,
                      repository: _repository,
                      reload: () => _loadTree(_subjectId),
                    ),
                  ),
            ] else if (chosen && modules == null && !_loading)
              Text(
                'Choose a subject to see its content.',
                style: TextStyle(fontSize: 13.5, color: muted),
              ),
          ],
        ),
      ),
    );
  }
}

class _ModuleCard extends StatefulWidget {
  const _ModuleCard({
    required this.module,
    required this.mayEdit,
    required this.repository,
    required this.reload,
  });

  final Module module;
  final bool mayEdit;
  final AcademicRepository repository;
  final Future<void> Function() reload;

  @override
  State<_ModuleCard> createState() => _ModuleCardState();
}

class _ModuleCardState extends State<_ModuleCard> {
  String _lessonTitle = '';
  bool _busy = false;
  ApiException? _error;

  Future<void> _run(Future<void> Function() work) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await work();
      if (!mounted) return;
      await widget.reload();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final m = widget.module;
    final published = m.publicationStatus == 'PUBLISHED';

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        m.title,
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
                      ),
                      if (m.description != null && m.description!.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          m.description!,
                          style: TextStyle(fontSize: 12.5, color: muted),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Pill(
                  text: published ? 'Published' : 'Draft',
                  kind: published ? PillKind.ok : PillKind.neutral,
                ),
              ],
            ),
          ),
          if (!published)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Text(
                'Students cannot see this module or anything inside it.',
                style: TextStyle(fontSize: 12, color: muted),
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: AppAlert(
                title: 'That did not work',
                message: _error!.message,
                reference: _error!.reference,
                details: serverDetailLines(_error!),
              ),
            ),
          if (widget.mayEdit)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  onPressed: _busy
                      ? null
                      : () => _run(() => widget.repository.setModulePublication(
                            m.id,
                            published ? 'UNPUBLISHED' : 'PUBLISHED',
                          )),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                  child: Text(published ? 'Unpublish' : 'Publish'),
                ),
              ),
            ),
          for (final lesson in m.lessons)
            _LessonRow(
              lesson: lesson,
              mayEdit: widget.mayEdit,
              repository: widget.repository,
              reload: widget.reload,
            ),
          if (widget.mayEdit)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
              child: Row(
                children: [
                  Expanded(
                    child: AdmissionFormField(
                      label: '',
                      value: _lessonTitle,
                      hint: 'New lesson — colour theory',
                      onChanged: (v) => setState(() => _lessonTitle = v),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: _busy || _lessonTitle.trim().length < 2
                        ? null
                        : () => _run(() async {
                              await widget.repository.createLesson(
                                moduleId: m.id,
                                title: _lessonTitle.trim(),
                              );
                              setState(() => _lessonTitle = '');
                            }),
                    child: const Text('Add'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _LessonRow extends StatelessWidget {
  const _LessonRow({
    required this.lesson,
    required this.mayEdit,
    required this.repository,
    required this.reload,
  });

  final Lesson lesson;
  final bool mayEdit;
  final AcademicRepository repository;
  final Future<void> Function() reload;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final l = lesson;
    final published = l.publicationStatus == 'PUBLISHED';

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l.title,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                    ),
                    if (l.estimatedMinutes != null)
                      Text(
                        '~${l.estimatedMinutes} min',
                        style: TextStyle(fontSize: 11.5, color: muted),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Pill(
                text: published ? 'Published' : 'Draft',
                kind: published ? PillKind.ok : PillKind.neutral,
              ),
              if (mayEdit) ...[
                const SizedBox(width: 6),
                IconButton(
                  onPressed: () {
                    repository
                        .setLessonPublication(
                            l.id, published ? 'UNPUBLISHED' : 'PUBLISHED')
                        .then<void>((_) => reload())
                        .catchError((Object _) {});
                  },
                  icon: Icon(
                    published ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                    size: 18,
                  ),
                  visualDensity: VisualDensity.compact,
                  tooltip: published ? 'Unpublish' : 'Publish',
                ),
              ],
            ],
          ),
          if (l.lectures.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final v in l.lectures)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 3),
                      child: Row(
                        children: [
                          const Icon(Icons.play_circle_outline, size: 14),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              v.title,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12.5, color: muted),
                            ),
                          ),
                          // ARC-045 — a missing file is stated here rather
                          // than discovered by a student meeting a broken
                          // player.
                          if (v.availabilityStatus != 'AVAILABLE')
                            const Text(
                              'file missing',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          const SizedBox(width: 6),
                          Pill(
                            text: v.publicationStatus == 'PUBLISHED' ? 'Live' : 'Draft',
                            kind: v.publicationStatus == 'PUBLISHED' ? PillKind.ok : PillKind.neutral,
                          ),
                        ],
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