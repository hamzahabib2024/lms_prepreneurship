import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../data/models/question_bank_models.dart';

/// Writing a question — FR-QIZ-004..012.
///
/// THE FORM CHANGES WITH THE TYPE, because the eight types are answered in
/// genuinely different ways. An options list shown greyed-out beside an essay
/// suggests an essay could have options; showing every field for every type
/// makes the teacher work out which ones apply.
///
/// It does not validate. The server decides whether a question is answerable
/// and returns every problem at once — a second copy of those rules here
/// would drift, and the copy that drifts is the one people trust because it
/// answers faster.
class QuestionComposer extends StatefulWidget {
  const QuestionComposer({
    super.key,
    required this.saving,
    required this.problems,
    required this.onSave,
  });

  final bool saving;

  /// Everything the server objected to, as separate lines.
  final List<String> problems;

  /// Returns true when the question was accepted, which is the signal to
  /// clear the form.
  final Future<bool> Function(QuestionDraft) onSave;

  @override
  State<QuestionComposer> createState() => _QuestionComposerState();
}

class _QuestionComposerState extends State<QuestionComposer> {
  final _draft = QuestionDraft();
  final _stem = TextEditingController();
  final _marks = TextEditingController(text: '2');
  final _answers = TextEditingController();
  final _optionControllers = <TextEditingController>[];

  @override
  void initState() {
    super.initState();
    _syncOptionControllers();
  }

  /// One controller per option row, created and disposed with the rows so a
  /// removed option does not leave a controller behind.
  void _syncOptionControllers() {
    while (_optionControllers.length < _draft.options.length) {
      final index = _optionControllers.length;
      _optionControllers.add(
        TextEditingController(text: _draft.options[index].text),
      );
    }
    while (_optionControllers.length > _draft.options.length) {
      _optionControllers.removeLast().dispose();
    }
    for (var i = 0; i < _draft.options.length; i++) {
      if (_optionControllers[i].text != _draft.options[i].text) {
        _optionControllers[i].text = _draft.options[i].text;
      }
    }
  }

  @override
  void dispose() {
    _stem.dispose();
    _marks.dispose();
    _answers.dispose();
    for (final controller in _optionControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    _draft
      ..stem = _stem.text
      ..marks = _marks.text
      ..acceptedAnswers = _answers.text;
    for (var i = 0; i < _draft.options.length; i++) {
      _draft.options[i].text = _optionControllers[i].text;
    }

    final accepted = await widget.onSave(_draft);
    if (!accepted || !mounted) return;

    setState(() {
      _stem.clear();
      _answers.clear();
      _draft.options = [DraftOption(), DraftOption()];
      if (_draft.type == QuestionType.trueFalse) {
        _draft.changeType(QuestionType.trueFalse);
      }
      _syncOptionControllers();
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        boxShadow: AppShadow.soft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.problems.isNotEmpty) ...[
            AppAlert(
              title: 'This question cannot be set yet',
              message: 'Fix these and try again:',
              details: widget.problems,
            ),
            const SizedBox(height: 14),
          ],

          DropdownButtonFormField<QuestionType>(
            initialValue: _draft.type,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Type',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: [
              for (final type in QuestionType.composable)
                DropdownMenuItem(
                  value: type,
                  child: Text(type.label, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() {
                _draft.changeType(value);
                _syncOptionControllers();
              });
            },
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _stem,
            minLines: 2,
            maxLines: 6,
            decoration: const InputDecoration(
              labelText: 'Question',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 12),

          TextField(
            controller: _marks,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
              labelText: 'Marks',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),

          if (_draft.type.hasOptions) ...[
            const SizedBox(height: 16),
            Text(
              _draft.type.isSingleAnswer
                  ? 'Options — tick the right one'
                  : 'Options — tick every right one',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
            const SizedBox(height: 6),
            for (var i = 0; i < _draft.options.length; i++)
              _OptionRow(
                controller: _optionControllers[i],
                isCorrect: _draft.options[i].isCorrect,
                // True/false options are the two words themselves; letting
                // somebody rename "True" would make a question nobody can read.
                readOnly: _draft.type == QuestionType.trueFalse,
                canRemove: _draft.type != QuestionType.trueFalse &&
                    _draft.options.length > 2,
                onCorrect: (value) => setState(() => _draft.markCorrect(i, value)),
                onRemove: () => setState(() {
                  _draft.options.removeAt(i);
                  _syncOptionControllers();
                }),
              ),
            if (_draft.type != QuestionType.trueFalse)
              TextButton.icon(
                onPressed: _draft.options.length >= 20
                    ? null
                    : () => setState(() {
                          _draft.options.add(DraftOption());
                          _syncOptionControllers();
                        }),
                icon: const Icon(Icons.add, size: 17),
                label: const Text('Add option'),
              ),
          ],

          if (_draft.type.hasAcceptedAnswers) ...[
            const SizedBox(height: 14),
            TextField(
              controller: _answers,
              minLines: 2,
              maxLines: 6,
              keyboardType: _draft.type == QuestionType.numeric
                  ? TextInputType.multiline
                  : TextInputType.multiline,
              decoration: InputDecoration(
                labelText: 'Accepted answers',
                helperText: _draft.type == QuestionType.numeric
                    ? 'One number per line.'
                    : 'One per line. Any of them is marked right.',
                helperMaxLines: 2,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],

          if (_draft.type == QuestionType.essay) ...[
            const SizedBox(height: 12),
            Text(
              'An essay is marked by you — it has no answer key, so it will '
              'wait in the marking queue after each attempt.',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],

          const SizedBox(height: 16),
          FilledButton(
            onPressed: widget.saving ? null : _save,
            child: Text(widget.saving ? 'Saving…' : 'Add to bank'),
          ),
        ],
      ),
    );
  }
}

class _OptionRow extends StatelessWidget {
  const _OptionRow({
    required this.controller,
    required this.isCorrect,
    required this.readOnly,
    required this.canRemove,
    required this.onCorrect,
    required this.onRemove,
  });

  final TextEditingController controller;
  final bool isCorrect;
  final bool readOnly;
  final bool canRemove;
  final void Function(bool) onCorrect;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Checkbox(
            value: isCorrect,
            onChanged: (value) => onCorrect(value ?? false),
            activeColor: dark ? AppColorsDark.ok : AppColors.ok,
          ),
          Expanded(
            child: TextField(
              controller: controller,
              readOnly: readOnly,
              decoration: const InputDecoration(
                hintText: 'Option text',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          if (canRemove)
            IconButton(
              onPressed: onRemove,
              icon: const Icon(Icons.close, size: 18),
              tooltip: 'Remove option',
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
