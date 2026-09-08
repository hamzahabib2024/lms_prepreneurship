import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme.dart';

class HowItWorksStep {
  const HowItWorksStep({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;
}

class HowItWorks extends StatefulWidget {
  const HowItWorks({
    super.key,
    required this.id,
    required this.title,
    this.intro,
    required this.steps,
    this.note,
  });

  final String id;
  final String title;
  final String? intro;
  final List<HowItWorksStep> steps;
  final String? note;

  @override
  State<HowItWorks> createState() => _HowItWorksState();
}

class _HowItWorksState extends State<HowItWorks> {
  bool? _open;

  @override
  void initState() {
    super.initState();
    _loadState();
  }

  Future<void> _loadState() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString('lms.howitworks.${widget.id}');
      setState(() => _open = stored != 'collapsed');
    } catch (_) {
      setState(() => _open = true);
    }
  }

  Future<void> _remember(bool next) async {
    setState(() => _open = next);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'lms.howitworks.${widget.id}',
        next ? 'open' : 'collapsed',
      );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_open == null) return const SizedBox.shrink();

    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    if (!_open!) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: GestureDetector(
          onTap: () => _remember(true),
          child: Row(
            children: [
              Icon(Icons.help_outline, size: 16, color: muted),
              const SizedBox(width: 6),
              Text(
                widget.title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: muted,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => _remember(false),
                child: Text(
                  'Hide',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: muted,
                  ),
                ),
              ),
            ],
          ),

          if (widget.intro != null) ...[
            const SizedBox(height: 8),
            Text(
              widget.intro!,
              style: TextStyle(fontSize: 13, color: muted),
            ),
          ],

          const SizedBox(height: 12),

          // Steps
          for (int i = 0; i < widget.steps.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Step number/icon
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: dark
                          ? AppColorsDark.brand600.withValues(alpha: 0.15)
                          : AppColors.brand600.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Icon(
                        widget.steps[i].icon,
                        size: 16,
                        color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // Step content
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.steps[i].title,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          widget.steps[i].body,
                          style: TextStyle(fontSize: 13, color: muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

          // Note
          if (widget.note != null) ...[
            const SizedBox(height: 4),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, size: 14, color: AppColors.warn),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    widget.note!,
                    style: TextStyle(
                      fontSize: 12,
                      color: dark ? AppColorsDark.warn : AppColors.warn,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
