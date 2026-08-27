import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/formats.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../../academic/class_page/data/class_page_repository.dart';
import '../../../academic/class_page/presentation/class_page.dart';

/// The title map — the web's WIDGET_TITLES, so an unknown widget still gets a
/// readable heading rather than its camelCase key.
const widgetTitles = <String, String>{
  'nextClass': 'Next class',
  'workDue': 'Due soon',
  'progress': 'My progress',
  'attendance': 'My attendance',
  'announcements': 'Announcements',
  'actionQueue': 'Needs your attention',
  'mySections': 'My subject-sections',
  'registrationQueue': 'Registrations',
  'instituteKpis': 'Institute',
  'acquisitionMix': 'Where students come from',
  'exceptions': 'Exceptions',
};

/// Renders one dashboard widget body, ported from the web's DashboardPage
/// WidgetBody switch. Every widget states why it is empty rather than showing
/// nothing at all (NFR-USE-009).
class DashboardWidgetBody extends StatelessWidget {
  const DashboardWidgetBody({super.key, required this.name, required this.value});

  final String name;
  final dynamic value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final mutedColor = dark ? AppColorsDark.muted : AppColors.muted;
    final v = (value is Map<String, dynamic> ? value : const <String, dynamic>{})
        as Map<String, dynamic>;
    final emptyMessage = v['message'] as String?;

    Widget empty([String? message]) => Text(
          message ?? emptyMessage ?? 'Nothing to show.',
          style: TextStyle(color: mutedColor, fontSize: 14),
        );

    switch (name) {
      case 'nextClass':
        if (v['hasNext'] != true) {
          return empty('Nothing scheduled.');
        }
        final subject = v['subject'] as Map<String, dynamic>? ?? const {};
        final scheduledStart = DateTime.tryParse(
              v['scheduledStart'] as String? ?? '',
            ) ??
            DateTime.now();
        final startsIn = (v['startsInSeconds'] as num?)?.toInt() ?? 0;
        final joinWindowOpen = v['joinWindowOpen'] == true;
        final linkReady = v['linkReady'] == true;
        final sessionId = v['sessionId'] as String? ?? '';
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              subject['name'] as String? ?? v['title'] as String? ?? '',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '${_formatDateTime(scheduledStart)} · '
              'starts in ${_formatDuration(startsIn)}',
              style: TextStyle(color: mutedColor, fontSize: 13),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: joinWindowOpen && sessionId.isNotEmpty
                    ? () => _openClassPage(context, sessionId)
                    : null,
                child: Text(joinWindowOpen ? 'Join class' : 'Join opens shortly'),
              ),
            ),
            // FR-LIV-019 — surfaced before the class, not during it.
            if (!linkReady)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'The class link is not ready yet.',
                  style: TextStyle(color: mutedColor, fontSize: 12.5),
                ),
              ),
          ],
        );

      case 'actionQueue':
        final total = (v['total'] as num?)?.toInt() ?? 0;
        if (total == 0) return empty('You are up to date.');
        return Column(
          children: [
            CounterRow(
              count: (v['unmarkedRegisters'] as num?)?.toInt() ?? 0,
              label: 'registers not marked',
            ),
            CounterRow(
              count: (v['ungradedSubmissions'] as num?)?.toInt() ?? 0,
              label: 'submissions to grade',
            ),
            CounterRow(
              count: (v['quizzesAwaitingMarking'] as num?)?.toInt() ?? 0,
              label: 'quiz answers to mark',
            ),
          ],
        );

      case 'registrationQueue':
        return Column(
          children: [
            CounterRow(
              count: (v['pending'] as num?)?.toInt() ?? 0,
              label: 'waiting for review',
            ),
            // FR-REG-038 — an application nobody has looked at for two days.
            CounterRow(
              count: (v['overdue'] as num?)?.toInt() ?? 0,
              label: 'waiting over 48 hours',
              warn: true,
            ),
            CounterRow(
              count: (v['decidedToday'] as num?)?.toInt() ?? 0,
              label: 'decided today',
            ),
          ],
        );

      case 'instituteKpis':
        return Column(
          children: [
            CounterRow(
              count: (v['activeStudents'] as num?)?.toInt() ?? 0,
              label: 'students',
            ),
            CounterRow(
              count: (v['activeTeachers'] as num?)?.toInt() ?? 0,
              label: 'teachers',
            ),
            CounterRow(
              count: (v['activeSections'] as num?)?.toInt() ?? 0,
              label: 'active sections',
            ),
            CounterRow(
              count: (v['sectionsAtCapacity'] as num?)?.toInt() ?? 0,
              label: 'sections full',
              warn: true,
            ),
          ],
        );

      case 'acquisitionMix': {
        final sources = (v['sources'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        if (sources.isEmpty) return empty('No data yet.');
        return Column(
          children: [
            for (final s in sources)
              ListRow(
                title: (s['source'] as String? ?? '').replaceAll('_', ' ').toLowerCase(),
                subtitle: null,
                trailing: Text(
                  '${s['count']}  (${s['percent']}%)',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
          ],
        );
      }

      case 'exceptions': {
        final items = (v['items'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        if (items.isEmpty) return empty('Nothing to action.');
        return Column(
          children: [
            for (final i in items)
              ListRow(
                title: i['message'] as String? ?? '',
                warn: i['severity'] == 'high',
              ),
          ],
        );
      }

      case 'mySections': {
        // The server sends this widget AS an array — the web client casts it
        // directly, and so does this one.
        final list = (value as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        if (list.isEmpty) return empty('No subject-sections assigned to you.');
        return Column(
          children: [
            for (final s in list)
              ListRow(
                title:
                    ((s['subject'] as Map<String, dynamic>? ?? const {})['name'] as String? ?? ''),
                subtitle: (s['section'] as Map<String, dynamic>? ?? const {})['code'] as String?,
                trailing: Text(
                  '${s['enrolled']}',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ),
          ],
        );
      }

      case 'attendance': {
        final overall = v['overall'] as Map<String, dynamic>? ?? const {};
        final percentage = (overall['percentage'] as num?)?.toDouble();
        if (percentage == null) return empty('No attendance recorded yet.');
        final below = v['isBelowThreshold'] == true;
        final threshold = v['threshold'];
        return Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            ProgressRing(percent: percentage, met: !below),
            const SizedBox(width: 18),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Pill(
                    text: below ? 'Below $threshold%' : 'Meeting the requirement',
                    kind: below ? PillKind.warn : PillKind.ok,
                  ),
                  const SizedBox(height: 8),
                  // FR-ATT-021 — the warning states the REQUIREMENT, not just
                  // a colour, and says what to do about it.
                  Text(
                    below
                        ? 'This is below the level required to complete the '
                            'subject. Speak to your teacher about catching up.'
                        : 'at least $threshold% is required',
                    style: TextStyle(
                      color: mutedColor,
                      fontSize: 12.5,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      }

      case 'progress': {
        final percent = (v['overallPercent'] as num?)?.toDouble() ?? 0;
        final subjects = (v['subjectCount'] as num?)?.toInt() ?? 0;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            ProgressRing(percent: percent),
            const SizedBox(width: 18),
            Expanded(
              child: Text(
                'across $subjects ${subjects == 1 ? 'subject' : 'subjects'}',
                style: TextStyle(color: mutedColor, fontSize: 13),
              ),
            ),
          ],
        );
      }

      case 'workDue': {
        final items = (v['items'] as List<dynamic>? ?? const [])
            .whereType<Map<String, dynamic>>()
            .toList();
        if (items.isEmpty) return empty('Nothing due.');
        return Column(
          children: [
            for (final i in items)
              ListRow(
                title: i['title'] as String? ?? '',
                subtitle: i['kind'] as String?,
                trailing: Text(
                  _shortDate(DateTime.tryParse(i['dueAt'] as String? ?? '')),
                  style: TextStyle(color: mutedColor, fontSize: 12.5),
                ),
              ),
          ],
        );
      }

      default:
        return empty();
    }
  }

  String _formatDuration(int seconds) {
    if (seconds <= 0) return 'now';
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    if (h > 24) return '${h ~/ 24} days';
    if (h > 0) return '$h h $m m';
    if (m > 0) return '$m min';
    return '$s sec';
  }

  String _shortDate(DateTime? date) {
    if (date == null) return '';
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day} ${months[date.month - 1]}';
  }

  String _formatDateTime(DateTime dt) {
    return Formats.shortDateTime(dt);
  }
}

void _openClassPage(BuildContext context, String sessionId) {
  final api = context.read<ApiClient>();
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => RepositoryProvider(
        create: (_) => ClassPageRepository(api),
        child: ClassPage(sessionId: sessionId),
      ),
    ),
  );
}