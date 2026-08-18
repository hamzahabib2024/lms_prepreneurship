import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A loading placeholder shaped like the thing that is coming. A block the
/// shape of the content holds the space so the screen does not jump when the
/// data arrives.
class Skeleton extends StatelessWidget {
  const Skeleton({super.key, this.lines = 3});

  final int lines;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? AppColorsDark.surface2 : AppColors.surface2;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < lines; i++)
          Container(
            height: 12,
            margin: const EdgeInsets.only(bottom: 10),
            width: double.infinity * (1.0 - i * 0.12).clamp(0.4, 1.0).toDouble(),
            decoration: BoxDecoration(
              color: base,
              borderRadius: BorderRadius.circular(6),
            ),
          ),
      ],
    );
  }
}

/// A page's worth of them, for a first load.
class SkeletonCards extends StatelessWidget {
  const SkeletonCards({super.key, this.count = 3});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < count; i++)
          Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
              borderRadius: BorderRadius.circular(AppRadius.md),
              boxShadow: AppShadow.soft,
            ),
            child: Skeleton(lines: 3),
          ),
      ],
    );
  }
}

/// The dashboard's cards: surface, 1px hairline of the page's colour along
/// the top, a page-hue dot before the heading — the same contract as the
/// web's `.card.widget`.
class WidgetCard extends StatelessWidget {
  const WidgetCard({
    super.key,
    required this.title,
    required this.child,
    this.pageColor = AppColors.brand600,
    this.unavailable = false,
  });

  final String title;
  final Widget child;
  final Color pageColor;

  /// { unavailable: true } — rendered as a dashed panel rather than omitted,
  /// because a silently missing panel looks like data that does not exist.
  final bool unavailable;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: unavailable ? theme.colorScheme.surfaceContainerHighest : theme.colorScheme.surface,
        border: unavailable
            ? Border.all(color: theme.colorScheme.outlineVariant, width: 1.5)
            : Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: unavailable ? null : AppShadow.soft,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // A hairline of the page's colour along the top — one pixel, only
          // on widgets. It ties a grid of cards to the screen they are on.
          if (!unavailable)
            Container(
              height: 2,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    pageColor.withValues(alpha: 0.7),
                    pageColor.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: pageColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                child,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A filled pill; the mobile equivalent of `.pill`. Never colour alone
  /// (NFR-ACC-007) — each variant pairs the colour with the word it carries.
class Pill extends StatelessWidget {
  const Pill({
    super.key,
    required this.text,
    this.kind = PillKind.neutral,
  });

  final String text;
  final PillKind kind;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (bg, fg, border) = switch (kind) {
      PillKind.neutral => (
          dark ? AppColorsDark.surface2 : AppColors.surface2,
          dark ? AppColorsDark.ink2 : AppColors.ink2,
          dark ? AppColorsDark.line : AppColors.line,
        ),
      PillKind.ok => (
          dark ? AppColorsDark.okBg : AppColors.okBg,
          dark ? AppColorsDark.ok : AppColors.ok,
          (dark ? AppColorsDark.ok : AppColors.ok).withValues(alpha: 0.3),
        ),
      PillKind.warn => (
          dark ? AppColorsDark.warnBg : AppColors.warnBg,
          dark ? AppColorsDark.warn : AppColors.warn,
          (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.3),
        ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: fg,
        ),
      ),
    );
  }
}

enum PillKind { neutral, ok, warn }

/// The `.alert` block — a labelled bar that states what happened, why, and a
/// support reference (NFR-ERR-003). Error and warning variants both carry
/// their colour as a left rule rather than as the whole surface.
class AppAlert extends StatelessWidget {
  const AppAlert({
    super.key,
    required this.title,
    required this.message,
    this.reference,
    this.warn = false,
  });

  final String title;
  final String message;
  final String? reference;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (bg, fg, border) = warn
        ? (
            dark ? AppColorsDark.warnBg : AppColors.warnBg,
            dark ? AppColorsDark.warn : AppColors.warn,
            (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.25),
          )
        : (
            dark ? AppColorsDark.errorBg : AppColors.errorBg,
            dark ? AppColorsDark.error : AppColors.error,
            (dark ? AppColorsDark.error : AppColors.error).withValues(alpha: 0.25),
          );

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: bg,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: DefaultTextStyle.merge(
        style: TextStyle(color: fg, fontSize: 13.5, height: 1.45),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 3),
            Text(message),
            if (reference != null)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(
                  'Reference: $reference',
                  style: TextStyle(
                    fontSize: 12,
                    color: (dark ? AppColorsDark.muted : AppColors.muted),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A list row; the mobile equivalent of `.list > li` — a counter or a
/// label/value pair separated by a hairline.
class ListRow extends StatelessWidget {
  const ListRow({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.warn = false,
  });

  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    color: warn ? warnColor : null,
                  ),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      style: TextStyle(fontSize: 12.5, color: muted),
                    ),
                  ),
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 12), trailing!],
        ],
      ),
    );
  }
}

/// A counter row — the number on the left, the explanation on the right.
class CounterRow extends StatelessWidget {
  const CounterRow({super.key, required this.count, required this.label, this.warn = false});

  final int count;
  final String label;

  /// A warn counter is shown only when the count is above zero — do not
  /// shout about zero problems.
  final bool warn;

  @override
  Widget build(BuildContext context) {
    if (warn && count <= 0) return const SizedBox.shrink();
    final dark = Theme.of(context).brightness == Brightness.dark;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;
    return ListRow(
      leading: SizedBox(
        width: 44,
        child: Text(
          '$count',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            fontFeatures: const [FontFeature.tabularFigures()],
            color: warn ? warnColor : null,
          ),
        ),
      ),
      title: label,
    );
  }
}

/// Progress as a ring. THE NUMBER IS IN THE MIDDLE — a ring alone is a shape
/// somebody has to estimate. The ring is the ornament; the number is the
/// answer.
class ProgressRing extends StatelessWidget {
  const ProgressRing({
    super.key,
    required this.percent,
    this.size = 84,
    this.met = false,
  });

  final double percent;
  final double size;

  /// The requirement is met: the value stroke turns ok-green, never by colour
  /// alone — the label beside it carries the word.
  final bool met;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final safe = percent.clamp(0, 100);
    final stroke = size < 60 ? 6.0 : 8.0;
    final valueColor = met
        ? (dark ? AppColorsDark.ok : AppColors.ok)
        : (dark ? AppColorsDark.brand600 : AppColors.brand600);
    final trackColor =
        dark ? AppColorsDark.surface2 : AppColors.surface2;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: size,
            height: size,
            child: CustomPaint(
              painter: _RingPainter(
                value: safe / 100,
                stroke: stroke,
                trackColor: trackColor,
                valueColor: valueColor,
              ),
            ),
          ),
          Text(
            '${safe.round()}%',
            style: TextStyle(
              fontSize: size * 0.24,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter({
    required this.value,
    required this.stroke,
    required this.trackColor,
    required this.valueColor,
  });

  final double value;
  final double stroke;
  final Color trackColor;
  final Color valueColor;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - stroke) / 2;

    final track = Paint()
      ..color = trackColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    canvas.drawCircle(center, radius, track);

    final arc = Paint()
      ..color = valueColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2,
      2 * math.pi * value.clamp(0.0, 1.0),
      false,
      arc,
    );
  }

  @override
  bool shouldRepaint(_RingPainter oldDelegate) =>
      oldDelegate.value != value ||
      oldDelegate.trackColor != trackColor ||
      oldDelegate.valueColor != valueColor;
}