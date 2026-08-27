import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../cubit/template_cubit.dart';
import '../data/template_repository.dart';
import '../data/models/template_models.dart';

class TemplatesPage extends StatefulWidget {
  const TemplatesPage({super.key, required this.api});
  final ApiClient api;

  @override
  State<TemplatesPage> createState() => _TemplatesPageState();
}

class _TemplatesPageState extends State<TemplatesPage> {
  late final TemplateCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = TemplateCubit(TemplateRepository(widget.api))..load();
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Messages'),
        ),
        body: BlocConsumer<TemplateCubit, TemplateState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
            if (state.success != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(state.success!),
                  backgroundColor: AppColors.ok,
                ),
              );
            }
          },
          builder: (context, state) {
            if (state.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            return RefreshIndicator(
              onRefresh: () => _cubit.load(),
              child:               ListView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                children: [
                  // Header
                  Text(
                    '${state.customizedCount} of ${state.templates.length} messages reworded',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Template cards
                  ...state.templates.map((t) => _TemplateCard(
                        template: t,
                        dark: dark,
                        cubit: _cubit,
                      )),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── Template card ──

class _TemplateCard extends StatefulWidget {
  const _TemplateCard({
    required this.template,
    required this.dark,
    required this.cubit,
  });

  final NotificationTemplate template;
  final bool dark;
  final TemplateCubit cubit;

  @override
  State<_TemplateCard> createState() => _TemplateCardState();
}

class _TemplateCardState extends State<_TemplateCard> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _bodyCtrl;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.template.title);
    _bodyCtrl = TextEditingController(text: widget.template.body);
  }

  @override
  void didUpdateWidget(covariant _TemplateCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.template.kind != widget.template.kind) {
      _titleCtrl.text = widget.template.title;
      _bodyCtrl.text = widget.template.body;
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  bool get _changed =>
      _titleCtrl.text != widget.template.title ||
      _bodyCtrl.text != widget.template.body;

  String _previewTitle() {
    final t = _titleCtrl.text;
    if (t.isEmpty) return widget.template.defaultTitle;
    return _renderLocally(t);
  }

  String _previewBody() {
    final b = _bodyCtrl.text;
    if (b.isEmpty) return widget.template.defaultBody;
    return _renderLocally(b);
  }

  String _renderLocally(String text) {
    // Simple placeholder replacement with example data
    final examples = <String, String>{
      'studentName': 'Ayesha Khan',
      'certificateNo': 'CERT/2026/00042',
      'subject': 'Mathematics',
      'programme': 'Secondary School',
      'assignment': 'Homework 3',
      'quiz': 'Chapter 1 Quiz',
      'percentage': '62%',
      'threshold': '75%',
      'amount': 'Rs. 15,000',
      'dueDate': '15 March 2026',
      'daysOverdue': '7',
    };

    var result = text;
    for (final entry in examples.entries) {
      result = result.replaceAll('{${entry.key}}', entry.value);
    }
    return result;
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    await widget.cubit.save(
      kind: widget.template.kind,
      title: _titleCtrl.text,
      body: _bodyCtrl.text,
    );
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _reset() async {
    setState(() => _busy = true);
    await widget.cubit.reset(widget.template.kind);
    if (mounted) {
      setState(() {
        _busy = false;
        _titleCtrl.text = widget.template.defaultTitle;
        _bodyCtrl.text = widget.template.defaultBody;
      });
    }
  }

  void _discard() {
    setState(() {
      _titleCtrl.text = widget.template.title;
      _bodyCtrl.text = widget.template.body;
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.template;
    final dark = widget.dark;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      color: dark ? AppColorsDark.surface : AppColors.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.label,
                        style: TextStyle(
                          color: dark ? AppColorsDark.ink : AppColors.ink,
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                      if (t.description.isNotEmpty)
                        Text(
                          t.description,
                          style: TextStyle(
                            color: dark ? AppColorsDark.muted : AppColors.muted,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: t.isCustomized
                        ? AppColors.brand600.withValues(alpha: 0.1)
                        : AppColors.muted.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    t.isCustomized ? 'Custom' : 'System',
                    style: TextStyle(
                      color: t.isCustomized
                          ? AppColors.brand600
                          : AppColors.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 12),

            // Title input
            Text(
              'Title',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 4),
            TextFormField(
              controller: _titleCtrl,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: t.defaultTitle,
                counterText: '${_titleCtrl.text.length}/200',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              maxLength: 200,
            ),

            const SizedBox(height: 12),

            // Body input
            Text(
              'Body',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.w500,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 4),
            TextFormField(
              controller: _bodyCtrl,
              onChanged: (_) => setState(() {}),
              maxLines: 4,
              decoration: InputDecoration(
                hintText: t.defaultBody,
                counterText: '${_bodyCtrl.text.length}/2000',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              maxLength: 2000,
            ),

            // Placeholder buttons
            if (t.placeholders.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: t.placeholders.map((p) {
                  return ActionChip(
                    label: Text(
                      '{$p}',
                      style: const TextStyle(fontSize: 11),
                    ),
                    onPressed: () {
                      final current = _bodyCtrl.text;
                      _bodyCtrl.text = '$current{$p}';
                      _bodyCtrl.selection = TextSelection.fromPosition(
                        TextPosition(offset: _bodyCtrl.text.length),
                      );
                      setState(() {});
                    },
                    visualDensity: VisualDensity.compact,
                  );
                }).toList(),
              ),
            ],

            // Preview
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: dark
                    ? AppColorsDark.surface2
                    : AppColors.surface2,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Preview',
                    style: TextStyle(
                      color: dark ? AppColorsDark.muted : AppColors.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _previewTitle(),
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _previewBody(),
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),

            // Actions
            const SizedBox(height: 12),
            Row(
              children: [
                if (_changed) ...[
                  FilledButton(
                    onPressed: _busy ? null : _save,
                    child: _busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('Save'),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    onPressed: _discard,
                    child: const Text('Discard'),
                  ),
                ],
                if (!_changed && t.isCustomized) ...[
                  OutlinedButton(
                    onPressed: _busy ? null : _reset,
                    child: const Text('Use system wording'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
