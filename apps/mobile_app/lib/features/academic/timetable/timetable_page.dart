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
/// words, before any grid. Three views: list (best on phone), week, and month.
/// The list degrades to a narrow phone screen without losing anything.
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

  /// View mode: list, week, or month.
  _ViewMode _viewMode = _ViewMode.list;

  /// Anchor date for navigation — the period is computed from this.
  DateTime _anchor = DateTime.now();

  @override
  void initState() {
    super.initState();
    _repository = AcademicRepository(api: widget.api);
    _canGenerate =
        widget.user.isSuperAdmin || widget.user.isAdmin || widget.user.isTeacher;
    _load();
  }

  /// The date range to fetch, computed from the anchor and view mode.
  ({DateTime from, DateTime to}) get _range {
    final start = DateTime(_anchor.year, _anchor.month, _anchor.day);
    final end = DateTime(_anchor.year, _anchor.month, _anchor.day);
    switch (_viewMode) {
      case _ViewMode.month:
        // Show month plus a week on each side for context.
        final from = DateTime(start.year, start.month - 1, 1);
        final to = DateTime(end.year, end.month + 1, 1);
        return (from: from, to: to);
      case _ViewMode.week:
        // Monday-based week.
        final lead = (start.weekday - 1);
        return (
          from: start.subtract(Duration(days: lead)),
          to: end.add(Duration(days: 6 - lead)),
        );
      case _ViewMode.list:
        // The next 14 days.
        return (from: start, to: end.add(const Duration(days: 14)));
    }
  }

  String get _periodLabel {
    switch (_viewMode) {
      case _ViewMode.month:
        const months = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December',
        ];
        return '${months[_anchor.month - 1]} ${_anchor.year}';
      case _ViewMode.week:
        final from = _range.from;
        return 'Week of ${_shortDate(from)}';
      case _ViewMode.list:
        return 'The next fortnight';
    }
  }

  String _shortDate(DateTime d) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${d.day} ${months[d.month - 1]}';
  }

  Future<void> _load() async {
    setState(() {
      _loading = _timetable == null;
      _error = null;
    });
    final range = _range;
    try {
      final t = await _repository.myTimetable(from: range.from, to: range.to);
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

  void _move(int direction) {
    setState(() {
      switch (_viewMode) {
        case _ViewMode.month:
          _anchor = DateTime(_anchor.year, _anchor.month + direction, 1);
        case _ViewMode.week:
          _anchor = _anchor.add(Duration(days: direction * 7));
        case _ViewMode.list:
          _anchor = _anchor.add(Duration(days: direction * 14));
      }
    });
    _load();
  }

  void _goToday() {
    setState(() => _anchor = DateTime.now());
    _load();
  }

  void _setView(_ViewMode mode) {
    setState(() => _viewMode = mode);
    _load();
  }

  void _openGenerate() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) =>
          GenerateSheet(repository: _repository, onGenerated: _load),
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
        actions: [
          // Today button
          TextButton(
            onPressed: _goToday,
            child: const Text('Today'),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            // Subtitle and view toggle
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Your classes. Times are local.',
                    style: TextStyle(fontSize: 12.5, color: muted),
                  ),
                ),
                SegmentedButton<_ViewMode>(
                  segments: const [
                    ButtonSegment(value: _ViewMode.list, label: Text('List')),
                    ButtonSegment(value: _ViewMode.week, label: Text('Week')),
                    ButtonSegment(value: _ViewMode.month, label: Text('Month')),
                  ],
                  selected: {_viewMode},
                  onSelectionChanged: (s) => _setView(s.first),
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
            const SizedBox(height: 8),
            // Navigation row
            Row(
              children: [
                IconButton(
                  onPressed: () => _move(-1),
                  icon: const Icon(Icons.chevron_left, size: 20),
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Previous',
                ),
                Expanded(
                  child: Text(
                    _periodLabel,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => _move(1),
                  icon: const Icon(Icons.chevron_right, size: 20),
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Next',
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
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        dayName(t.nextClass!.scheduledStart),
                        'at ${time(t.nextClass!.scheduledStart)}',
                        if ((t.nextClass?.teacher ?? '').isNotEmpty)
                          t.nextClass!.teacher!,
                        if (t.nextClass!.section.isNotEmpty)
                          t.nextClass!.section,
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
            else if (_viewMode == _ViewMode.month)
              _MonthCalendar(
                anchor: _anchor,
                days: t.days,
                onPickDay: (date) {
                  setState(() {
                    _anchor = date;
                    _viewMode = _ViewMode.list;
                  });
                  _load();
                },
              )
            else if (_viewMode == _ViewMode.week)
              _WeekView(
                anchor: _anchor,
                days: t.days,
                onPickDay: (date) {
                  setState(() {
                    _anchor = date;
                    _viewMode = _ViewMode.list;
                  });
                  _load();
                },
              )
            else
              // List view — the default and best for phones.
              for (final day in t.days)
                _DayCard(day: day),
          ],
        ),
      ),
    );
  }
}

enum _ViewMode { list, week, month }

/// A single day's card in list view.
class _DayCard extends StatelessWidget {
  const _DayCard({required this.day});

  final TimetableDay day;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final today = _bareDate(DateTime.now());
    final isToday = day.date == today;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isToday
            ? (dark ? AppColorsDark.brand050 : AppColors.brand050)
            : Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: isToday
              ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                  .withValues(alpha: 0.3)
              : (dark ? AppColorsDark.line : AppColors.line),
        ),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            dayNameFor(day.date) + (isToday ? ' (Today)' : ''),
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
                              if (e.title.isNotEmpty && e.title != e.subject)
                                e.title,
                              if ((e.teacher ?? '').isNotEmpty) e.teacher!,
                              if (e.section.isNotEmpty) e.section,
                            ].join(' · '),
                            style: TextStyle(fontSize: 12, color: muted),
                          ),
                      ],
                    ),
                  ),
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
    );
  }
}

/// Week view — 7 columns with events stacked vertically.
class _WeekView extends StatelessWidget {
  const _WeekView({
    required this.anchor,
    required this.days,
    required this.onPickDay,
  });

  final DateTime anchor;
  final List<TimetableDay> days;
  final void Function(DateTime date) onPickDay;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final today = _bareDate(DateTime.now());

    // Build 7 days starting from Monday.
    final lead = (anchor.weekday - 1);
    final start = anchor.subtract(Duration(days: lead));
    final columns = List.generate(7, (i) => start.add(Duration(days: i)));

    // Index entries by date.
    final byDate = <String, List<TimetableEntry>>{};
    for (final d in days) {
      byDate[d.date] = d.entries;
    }

    return Column(
      children: [
        for (final date in columns) ...[
          _WeekDayHeader(
            date: date,
            isToday: _bareDate(date) == today,
            onTap: () => onPickDay(date),
          ),
          SizedBox(
            height: 80,
            child: () {
              final entries = byDate[_bareDate(date)];
              if (entries == null || entries.isEmpty) {
                return Center(
                  child: Text('—', style: TextStyle(color: muted)),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 4),
                itemCount: entries.length,
                itemBuilder: (_, i) {
                  final e = entries[i];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      '${time(e.scheduledStart)} ${e.subject}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                },
              );
            }(),
          ),
          const Divider(height: 1),
        ],
      ],
    );
  }
}

class _WeekDayHeader extends StatelessWidget {
  const _WeekDayHeader({
    required this.date,
    required this.isToday,
    required this.onTap,
  });

  final DateTime date;
  final bool isToday;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        color: isToday
            ? (dark ? AppColorsDark.brand050 : AppColors.brand050)
            : null,
        child: Row(
          children: [
            const SizedBox(width: 12),
            Text(
              weekdays[date.weekday - 1],
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: dark ? AppColorsDark.muted : AppColors.muted,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              '${date.day}',
              style: TextStyle(
                fontSize: 14,
                fontWeight: isToday ? FontWeight.w700 : FontWeight.w600,
                color: isToday
                    ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Month calendar view — a grid of days with event chips.
class _MonthCalendar extends StatelessWidget {
  const _MonthCalendar({
    required this.anchor,
    required this.days,
    required this.onPickDay,
  });

  final DateTime anchor;
  final List<TimetableDay> days;
  final void Function(DateTime date) onPickDay;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final today = _bareDate(DateTime.now());

    // Index entries by date.
    final byDate = <String, List<TimetableEntry>>{};
    for (final d in days) {
      byDate[d.date] = d.entries;
    }

    // Build 6 weeks of cells.
    final first = DateTime(anchor.year, anchor.month, 1);
    final lead = (first.weekday - 1);
    final start = first.subtract(Duration(days: lead));
    final cells = List.generate(42, (i) => start.add(Duration(days: i)));

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    final currentMonth = anchor.month;

    return Column(
      children: [
        // Weekday headers
        Row(
          children: [
            for (final w in weekdays)
              Expanded(
                child: Center(
                  child: Text(
                    w,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: muted,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        // Calendar grid
        for (int row = 0; row < 6; row++)
          Row(
            children: [
              for (int col = 0; col < 7; col++) ...[
                if (col > 0) const SizedBox(width: 2),
                Expanded(
                  child: () {
                    final date = cells[row * 7 + col];
                    final key = _bareDate(date);
                    final entries = byDate[key] ?? [];
                    final isCurrentMonth = date.month == currentMonth;
                    final isTodayCell = key == today;
                    final shown = entries.take(2).toList();
                    final more = entries.length - shown.length;

                    return InkWell(
                      onTap: () => onPickDay(date),
                      borderRadius: BorderRadius.circular(6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          vertical: 4,
                          horizontal: 2,
                        ),
                        decoration: isTodayCell
                            ? BoxDecoration(
                                color: dark
                                    ? AppColorsDark.brand600
                                    : AppColors.brand600,
                                borderRadius: BorderRadius.circular(6),
                              )
                            : null,
                        child: Column(
                          children: [
                            Text(
                              '${date.day}',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: isTodayCell
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: isTodayCell
                                    ? Colors.white
                                    : isCurrentMonth
                                        ? null
                                        : muted,
                              ),
                            ),
                            for (final e in shown)
                              Container(
                                margin: const EdgeInsets.only(top: 1),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 3,
                                  vertical: 1,
                                ),
                                decoration: BoxDecoration(
                                  color: _subjectHue(e.subject),
                                  borderRadius: BorderRadius.circular(3),
                                ),
                                child: Text(
                                  time(e.scheduledStart),
                                  style: const TextStyle(
                                    fontSize: 8,
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            if (more > 0)
                              Text(
                                '+$more',
                                style: TextStyle(
                                  fontSize: 8,
                                  color: muted,
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  }(),
                ),
              ],
            ],
          ),
      ],
    );
  }
}

/// Generate a consistent hue for a subject name.
Color _subjectHue(String subject) {
  int h = 0;
  for (int i = 0; i < subject.length; i++) {
    h = (h * 31 + subject.codeUnitAt(i)) % 360;
  }
  final hue = (h / 60).round() * 60;
  return HSLColor.fromAHSL(1.0, hue.toDouble(), 0.5, 0.45).toColor();
}

/// The bare date string "2026-08-20" for matching server dates.
String _bareDate(DateTime d) {
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
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
String dayNameFor(String date) =>
    dayName(DateTime.tryParse(date) ?? DateTime.now());

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
  const GenerateSheet({
    super.key,
    required this.repository,
    required this.onGenerated,
  });

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
      _sectionSubjectId.isNotEmpty &&
      _days.isNotEmpty &&
      _fromDate != null &&
      _toDate != null;

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
                    firstDate:
                        DateTime.now().subtract(const Duration(days: 7)),
                    lastDate:
                        DateTime.now().add(const Duration(days: 730)),
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
                    firstDate:
                        DateTime.now().subtract(const Duration(days: 7)),
                    lastDate:
                        DateTime.now().add(const Duration(days: 730)),
                    onChanged: (v) {
                      setState(() {
                        _toDate = v;
                        _preview = null;
                      });
                    },
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _busy ||
                            !_ready ||
                            _hostTeacherId == null
                        ? null
                        : () => _run('preview', _previewCall),
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Check what this would create'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: _busy ||
                            _preview == null ||
                            _preview!.count == 0
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
                      style: TextStyle(
                        fontSize: 12.5,
                        color: muted,
                        height: 1.4,
                      ),
                    ),
                  ],
                  if (_result != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _result!.failed > 0
                            ? (dark
                                ? AppColorsDark.warnBg
                                : AppColors.warnBg)
                            : (dark
                                ? AppColorsDark.okBg
                                : AppColors.okBg),
                        border: Border.all(
                          color: (_result!.failed > 0
                                  ? (dark
                                      ? AppColorsDark.warn
                                      : AppColors.warn)
                                  : (dark
                                      ? AppColorsDark.ok
                                      : AppColors.ok))
                              .withValues(alpha: 0.3),
                        ),
                        borderRadius:
                            BorderRadius.circular(AppRadius.sm),
                      ),
                      child: Text(
                        _result!.summary,
                        style: const TextStyle(
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
