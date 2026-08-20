import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../../admission/widgets/form_controls.dart';
import '../../auth/data/models/auth_session.dart';
import '../data/academic_repository.dart';
import '../data/models/timetable.dart';

/// The timetable — SRS §13.12, FR-LIV-030..036.
///
/// THE NEXT CLASS IS THE POINT OF THE PAGE: it is stated once at the top, in
/// words, before any grid. Days are listed rather than laid out as a grid — a
/// list degrades to a narrow phone screen without losing anything. Whose
/// timetable it is comes from the token, not from a parameter.
class TimetablePage extends StatefulWidget {
  const TimetablePage({super.key, required this.api, required this.user});

  final ApiClient api;
  final AuthUser user;

  @override
  State<TimetablePage> createState() => _TimetablePageState();
}

class _TimetablePageState extends State<TimetablePage> {
  late final AcademicRepository _repository;
  late final bool _canGenerate;

  Timetable? _timetable;
  bool _loading = true;
  ApiException? _error;
  String _weeks = '2';

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _canGenerate = widget.user.isSuperAdmin || widget.user.isAdmin || widget.user.isTeacher;
    _load();
  }

  Future<void> _load() async {
    final weeks = int.parse(_weeks);
    setState(() {
      _loading = _timetable == null;
      _error = null;
    });
    final now = DateTime.now();
    try {
      final t = await _repository.myTimetable(
        from: now,
        to: now.add(Duration(days: weeks * 7)),
      );
      if (!mounted) return;
      setState(() {
        _timetable = t;
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

  void _openGenerate() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => GenerateSheet(repository: _repository, onGenerated: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    final t = _timetable;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Timetable'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Your classes. Times are local.',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: '1', label: Text('1w')),
                    ButtonSegment(value: '2', label: Text('2w')),
                    ButtonSegment(value: '4', label: Text('4w')),
                  ],
                  selected: {_weeks},
                  onSelectionChanged: (s) {
                    setState(() => _weeks = s.first);
                    _load();
                  },
                  showSelectedIcon: false,
                  style: ButtonStyle(
                    visualDensity: VisualDensity.compact,
                    textStyle: WidgetStatePropertyAll(
                      TextStyle(
                        fontSize: 12,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                  ),
                ),
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
              const SizedBox(height: 14),
            ],
            // The one fact most people came for, before anything else.
            if (t?.nextClass != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                    color: (dark ? AppColorsDark.brand600 : AppColors.brand600)
                        .withValues(alpha: 0.25),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Next: ${t!.nextClass!.subject} — ${whenNext(t.nextClass!.scheduledStart)}',
                      style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        dayName(t.nextClass!.scheduledStart),
                        'at ${time(t.nextClass!.scheduledStart)}',
                        if ((t.nextClass?.teacher ?? '').isNotEmpty) t.nextClass!.teacher!,
                        if (t.nextClass!.section.isNotEmpty) t.nextClass!.section,
                      ].join(' · '),
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ],
                ),
              ),
            if (_canGenerate)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: OutlinedButton.icon(
                  onPressed: _openGenerate,
                  icon: const Icon(Icons.event_repeat, size: 18),
                  label: const Text("Set up a term's classes"),
                ),
              ),
            if (_loading)
              const SkeletonCards(count: 3)
            else if (t == null)
              const SizedBox.shrink()
            else if (t.days.isEmpty)
              Text(
                t.message ?? 'No classes scheduled in this period.',
                style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
              )
            else
              for (final day in t.days)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        dayNameFor(day.date),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 6),
                      for (final e in day.entries)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '${time(e.scheduledStart)}–${time(e.scheduledEnd)}  '
                                      '${e.subject}',
                                      style: const TextStyle(
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    if ((e.title.isNotEmpty && e.title != e.subject) ||
                                        (e.teacher ?? '').isNotEmpty ||
                                        e.section.isNotEmpty)
                                      Text(
                                        [
                                          if (e.title.isNotEmpty && e.title != e.subject) e.title,
                                          if ((e.teacher ?? '').isNotEmpty) e.teacher!,
                                          if (e.section.isNotEmpty) e.section,
                                        ].join(' · '),
                                        style: TextStyle(fontSize: 12, color: muted),
                                      ),
                                  ],
                                ),
                              ),
                              // LIVE is worth saying as a word: it means join now.
                              if (e.status == 'LIVE')
                                const Padding(
                                  padding: EdgeInsets.only(left: 8, top: 2),
                                  child: Pill(text: 'Live now', kind: PillKind.ok),
                                ),
                            ],
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

/// "in 2 hours", "tomorrow at 09:00" — the form somebody actually wants.
String whenNext(DateTime iso) {
  final start = iso.toLocal();
  final minutes = start.difference(DateTime.now()).inMinutes;
  if (minutes <= 0) return 'now';
  if (minutes < 60) return 'in $minutes minute${minutes == 1 ? '' : 's'}';
  final hours = (minutes / 60).round();
  if (hours < 24) return 'in $hours hour${hours == 1 ? '' : 's'}';
  final days = (hours / 24).round();
  return days == 1 ? 'tomorrow' : 'in $days days';
}

String time(DateTime iso) {
  final l = iso.toLocal();
  final h = l.hour.toString().padLeft(2, '0');
  final m = l.minute.toString().padLeft(2, '0');
  return '$h:$m';
}

String dayName(DateTime iso) {
  final l = iso.toLocal();
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${weekdays[l.weekday - 1]}, ${l.day} ${months[l.month - 1]}';
}

/// The day's name from the server's bare-date identity ("2026-08-20").
String dayNameFor(String date) => dayName(DateTime.tryParse(date) ?? DateTime.now());

const _dayOptions = <(int, String)>[
  (1, 'Mon'),
  (2, 'Tue'),
  (3, 'Wed'),
  (4, 'Thu'),
  (5, 'Fri'),
  (6, 'Sat'),
  (0, 'Sun'),
];

/// FR-LIV-031/032 — describe a term once. PREVIEW BEFORE GENERATE: the
/// generate button is unreachable until the pattern has been checked.
class GenerateSheet extends StatefulWidget {
  const GenerateSheet({super.key, required this.repository, required this.onGenerated});

  final AcademicRepository repository;
  final Future<void> Function() onGenerated;

  @override
  State<GenerateSheet> createState() => _GenerateSheetState();
}

class _GenerateSheetState extends State<GenerateSheet> {
  List<OfferingChoice> _offerings = const [];
  List<TeacherLoad> _teachers = const [];
  bool _catalogueReady = false;

  String _sectionSubjectId = '';
  final Set<int> _days = {1, 3};
  String _startTime = '09:00';
  String _endTime = '11:00';
  DateTime? _fromDate;
  DateTime? _toDate;

  TimetablePreview? _preview;
  TimetableReport? _result;
  ApiException? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadCatalogue();
  }

  Future<void> _loadCatalogue() async {
    try {
      final choices = await widget.repository.offeringChoices();
      final teachers = await widget.repository.teacherWorkload();
      if (!mounted) return;
      setState(() {
        _offerings = choices;
        _teachers = teachers.where((t) => t.assignable).toList();
        _catalogueReady = true;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _catalogueReady = true;
        _error = error;
      });
    }
  }

  String? get _hostTeacherId {
    if (_teachers.isEmpty) return null;
    return _teachers.first.teacherId;
  }

  bool get _ready =>
      _sectionSubjectId.isNotEmpty && _days.isNotEmpty && _fromDate != null && _toDate != null;

  Future<void> _run(String path, Future<Object?> Function() call) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final value = await call();
      if (!mounted) return;
      setState(() => _busy = false);
      if (value is TimetablePreview) {
        setState(() {
          _preview = value;
          _result = null;
        });
      } else if (value is TimetableReport) {
        await widget.onGenerated();
        if (!mounted) return;
        setState(() {
          _result = value;
          _preview = null;
        });
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error;
      });
    }
  }

  Future<TimetablePreview> _previewCall() {
    return widget.repository.previewTimetable(
      sectionSubjectId: _sectionSubjectId,
      days: _days.toList(),
      startTime: _startTime.trim(),
      endTime: _endTime.trim(),
      fromDate: _fromDate!,
      toDate: _toDate!,
      hostTeacherId: _hostTeacherId!,
    );
  }

  Future<TimetableReport> _generateCall() {
    return widget.repository.generateTimetable(
      sectionSubjectId: _sectionSubjectId,
      days: _days.toList(),
      startTime: _startTime.trim(),
      endTime: _endTime.trim(),
      fromDate: _fromDate!,
      toDate: _toDate!,
      hostTeacherId: _hostTeacherId!,
    );
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

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
                "Set up a term's classes",
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Describe a weekly pattern once; the classes are created for every '
                'occurrence. Check what it would create before creating it.',
                style: TextStyle(fontSize: 12.5, color: muted, height: 1.5),
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
                  if (_hostTeacherId == null && _catalogueReady)
                    Text(
                      'No active teacher is available to host these classes.',
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  const SizedBox(height: 12),
                  AdmissionSelectField(
                    label: 'Which class',
                    value: _sectionSubjectId,
                    hint: 'Choose…',
                    options: [
                      for (final o in _offerings)
                        (o.id, o.hasTeacher ? '${o.label} ✓' : o.label),
                    ],
                    onChanged: (v) {
                      setState(() {
                        _sectionSubjectId = v;
                        _preview = null;
                        _result = null;
                      });
                    },
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Which days',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: dark ? AppColorsDark.ink2 : AppColors.ink2,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final (value, label) in _dayOptions)
                        FilterChip(
                          label: Text(label),
                          selected: _days.contains(value),
                          onSelected: (on) {
                            setState(() {
                              if (on) {
                                _days.add(value);
                              } else {
                                _days.remove(value);
                              }
                              _preview = null;
                              _result = null;
                            });
                          },
                          visualDensity: VisualDensity.compact,
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: AdmissionFormField(
                          label: 'Starts at',
                          value: _startTime,
                          hint: '09:00',
                          keyboardType: TextInputType.datetime,
                          onChanged: (v) {
                            setState(() {
                              _startTime = v;
                              _preview = null;
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: AdmissionFormField(
                          label: 'Ends at',
                          value: _endTime,
                          hint: '11:00',
                          keyboardType: TextInputType.datetime,
                          onChanged: (v) {
                            setState(() {
                              _endTime = v;
                              _preview = null;
                            });
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  AdmissionDateField(
                    label: 'Term starts',
                    value: _fromDate,
                    hint: 'Choose…',
                    firstDate: DateTime.now().subtract(const Duration(days: 7)),
                    lastDate: DateTime.now().add(const Duration(days: 730)),
                    onChanged: (v) {
                      setState(() {
                        _fromDate = v;
                        _preview = null;
                      });
                    },
                  ),
                  const SizedBox(height: 12),
                  AdmissionDateField(
                    label: 'Term ends',
                    value: _toDate,
                    hint: 'Choose…',
                    firstDate: DateTime.now().subtract(const Duration(days: 7)),
                    lastDate: DateTime.now().add(const Duration(days: 730)),
                    onChanged: (v) {
                      setState(() {
                        _toDate = v;
                        _preview = null;
                      });
                    },
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed:
                        _busy || !_ready || _hostTeacherId == null ? null : () => _run(
                              'preview',
                              _previewCall,
                            ),
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Check what this would create'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: _busy || _preview == null || _preview!.count == 0
                        ? null
                        : () => _run('generate', _generateCall),
                    child: Text(
                      _preview == null
                          ? 'Create classes'
                          : 'Create ${_preview!.count} '
                              '${_preview!.count == 1 ? 'class' : 'classes'}',
                    ),
                  ),
                  if (_preview != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _preview!.message,
                      style: TextStyle(fontSize: 12.5, color: muted, height: 1.4),
                    ),
                  ],
                  if (_result != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _result!.failed > 0
                            ? (dark ? AppColorsDark.warnBg : AppColors.warnBg)
                            : (dark ? AppColorsDark.okBg : AppColors.okBg),
                        border: Border.all(
                          color: (_result!.failed > 0
                                  ? (dark ? AppColorsDark.warn : AppColors.warn)
                                  : (dark ? AppColorsDark.ok : AppColors.ok))
                              .withValues(alpha: 0.3),
                        ),
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Text(
                        _result!.summary,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          height: 1.4,
                        ),
                      ),
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
}