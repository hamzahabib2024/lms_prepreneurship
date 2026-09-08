import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

class CalendarEntry {
  const CalendarEntry({
    required this.id,
    required this.title,
    required this.subject,
    required this.section,
    this.teacher,
    required this.scheduledStart,
    required this.scheduledEnd,
    required this.status,
  });

  final String id;
  final String title;
  final String subject;
  final String section;
  final String? teacher;
  final DateTime scheduledStart;
  final DateTime scheduledEnd;
  final String status;
}

class CalendarDay {
  const CalendarDay({
    required this.date,
    required this.entries,
  });

  final DateTime date;
  final List<CalendarEntry> entries;
}

/// A stable hue per subject, derived from its name.
int subjectHue(String subject) {
  int h = 0;
  for (int i = 0; i < subject.length; i++) {
    h = (h * 31 + subject.codeUnitAt(i)) % 360;
  }
  return (h ~/ 60) * 60;
}

Color subjectColor(String subject) {
  final hue = subjectHue(subject);
  return HSLColor.fromAHSL(1.0, hue.toDouble(), 0.5, 0.65).toColor();
}

class MonthView extends StatelessWidget {
  const MonthView({
    super.key,
    required this.anchor,
    required this.days,
    required this.onPickDay,
  });

  final DateTime anchor;
  final List<CalendarDay> days;
  final ValueChanged<DateTime> onPickDay;

  @override
  Widget build(BuildContext context) {
    final byDate = <String, List<CalendarEntry>>{};
    for (final day in days) {
      byDate[_iso(day.date)] = day.entries;
    }

    final first = DateTime(anchor.year, anchor.month, 1);
    final lead = (first.weekday - 1) % 7;
    final start = first.subtract(Duration(days: lead));

    final cells = List.generate(42, (i) {
      final d = start.add(Duration(days: i));
      return d;
    });

    final today = _iso(DateTime.now());
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      children: [
        // Weekday headers
        Row(
          children: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
              .map((d) => Expanded(
                    child: Center(
                      child: Text(
                        d,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: dark ? AppColorsDark.muted : AppColors.muted,
                        ),
                      ),
                    ),
                  ))
              .toList(),
        ),
        const SizedBox(height: 4),
        // Calendar grid
        for (int row = 0; row < 6; row++)
          Row(
            children: List.generate(7, (col) {
              final d = cells[row * 7 + col];
              final key = _iso(d);
              final entries = byDate[key] ?? [];
              final isCurrentMonth = d.month == anchor.month;
              final isTodayCell = key == today;
              final shown = entries.take(2).toList();
              final more = entries.length - shown.length;

              return Expanded(
                child: GestureDetector(
                  onTap: () => onPickDay(d),
                  child: Container(
                    margin: const EdgeInsets.all(1),
                    padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                    decoration: BoxDecoration(
                      color: isTodayCell
                          ? (dark ? AppColorsDark.brand600.withValues(alpha: 0.15) : AppColors.brand600.withValues(alpha: 0.08))
                          : null,
                      borderRadius: BorderRadius.circular(4),
                      border: isTodayCell
                          ? Border.all(color: dark ? AppColorsDark.brand600 : AppColors.brand600)
                          : null,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${d.day}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: isTodayCell ? FontWeight.w700 : FontWeight.w500,
                            color: isCurrentMonth
                                ? (dark ? AppColorsDark.ink : AppColors.ink)
                                : (dark ? AppColorsDark.muted : AppColors.muted).withValues(alpha: 0.5),
                          ),
                        ),
                        for (final e in shown)
                          Container(
                            margin: const EdgeInsets.only(top: 1),
                            padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                            decoration: BoxDecoration(
                              color: subjectColor(e.subject).withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(2),
                            ),
                            child: Text(
                              '${_hhmm(e.scheduledStart)} ${e.subject}',
                              style: TextStyle(
                                fontSize: 8,
                                color: subjectColor(e.subject),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        if (more > 0)
                          Text(
                            '+$more more',
                            style: TextStyle(
                              fontSize: 8,
                              color: dark ? AppColorsDark.muted : AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
      ],
    );
  }

  String _iso(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  String _hhmm(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }
}

class WeekView extends StatelessWidget {
  const WeekView({
    super.key,
    required this.anchor,
    required this.days,
    required this.onPickDay,
  });

  final DateTime anchor;
  final List<CalendarDay> days;
  final ValueChanged<DateTime> onPickDay;

  @override
  Widget build(BuildContext context) {
    final byDate = <String, List<CalendarEntry>>{};
    for (final day in days) {
      byDate[_iso(day.date)] = day.entries;
    }

    final lead = (anchor.weekday - 1) % 7;
    final start = anchor.subtract(Duration(days: lead));
    final columns = List.generate(7, (i) => start.add(Duration(days: i)));

    final today = _iso(DateTime.now());
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: columns.map((d) {
        final key = _iso(d);
        final entries = byDate[key] ?? [];
        final isTodayCol = key == today;

        return Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            decoration: isTodayCol
                ? BoxDecoration(
                    color: dark
                        ? AppColorsDark.brand600.withValues(alpha: 0.08)
                        : AppColors.brand600.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                  )
                : null,
            child: Column(
              children: [
                // Day header
                GestureDetector(
                  onTap: () => onPickDay(d),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(
                      children: [
                        Text(
                          _weekDayShort(d.weekday),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: muted,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${d.day}',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: isTodayCol ? FontWeight.w700 : FontWeight.w600,
                            color: dark ? AppColorsDark.ink : AppColors.ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 1),
                // Events
                Padding(
                  padding: const EdgeInsets.all(4),
                  child: entries.isEmpty
                      ? SizedBox(
                          height: 40,
                          child: Center(
                            child: Text(
                              '\u2014',
                              style: TextStyle(fontSize: 12, color: muted),
                            ),
                          ),
                        )
                      : Column(
                          children: entries.map((e) {
                            return Container(
                              width: double.infinity,
                              margin: const EdgeInsets.only(bottom: 4),
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: subjectColor(e.subject).withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(4),
                                border: Border(
                                  left: BorderSide(
                                    color: subjectColor(e.subject),
                                    width: 3,
                                  ),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _hhmm(e.scheduledStart),
                                    style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700,
                                      color: dark ? AppColorsDark.ink : AppColors.ink,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    e.subject,
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: subjectColor(e.subject),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  Text(
                                    e.section,
                                    style: TextStyle(fontSize: 10, color: muted),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ],
                              ),
                            );
                          }).toList(),
                        ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  String _iso(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  String _hhmm(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  String _weekDayShort(int weekday) {
    switch (weekday) {
      case 1:
        return 'Mon';
      case 2:
        return 'Tue';
      case 3:
        return 'Wed';
      case 4:
        return 'Thu';
      case 5:
        return 'Fri';
      case 6:
        return 'Sat';
      case 7:
        return 'Sun';
      default:
        return '';
    }
  }
}
