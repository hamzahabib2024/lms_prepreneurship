import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../cubit/public_page_cubit.dart';
import '../data/public_page_repository.dart';
import '../data/models/public_page_models.dart';

class PublicPageEditorPage extends StatefulWidget {
  const PublicPageEditorPage({super.key, required this.api});
  final ApiClient api;

  @override
  State<PublicPageEditorPage> createState() => _PublicPageEditorPageState();
}

class _PublicPageEditorPageState extends State<PublicPageEditorPage> {
  late final PublicPageCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = PublicPageCubit(PublicPageRepository(widget.api))..load();
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
          title: const Text('Public Page'),
          actions: [
            BlocBuilder<PublicPageCubit, PublicPageState>(
              builder: (context, state) {
                if (state.success != null) {
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Center(
                      child: Text(
                        state.success!,
                        style: const TextStyle(color: AppColors.ok, fontSize: 12),
                      ),
                    ),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ],
        ),
        body: BlocConsumer<PublicPageCubit, PublicPageState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.loading || state.doc == null) {
              return const Center(child: CircularProgressIndicator());
            }

            final doc = state.doc!;
            final sections = _groupFields(doc.fields);

            return Column(
              children: [
                // Dirty indicator
                if (state.changeCount > 0)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    color: AppColors.warn.withValues(alpha: 0.1),
                    child: Text(
                      '${state.changeCount} change(s) not saved',
                      style: const TextStyle(
                        color: AppColors.warn,
                        fontWeight: FontWeight.w600,
                        fontSize: 12,
                      ),
                    ),
                  ),

                // Fields
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Institute name (read-only)
                      if (doc.instituteName.isNotEmpty) ...[
                        _ReadonlyField(
                          label: 'Institute name',
                          value: doc.instituteName,
                          dark: dark,
                        ),
                        const SizedBox(height: 16),
                      ],

                      // Sections
                      ...sections.entries.map((entry) {
                        return _EditorSection(
                          title: entry.key,
                          fields: entry.value,
                          dark: dark,
                          cubit: _cubit,
                        );
                      }),
                    ],
                  ),
                ),

                // Save bar
                _SaveBar(
                  changeCount: state.changeCount,
                  saving: state.saving,
                  dark: dark,
                  onSave: () => _cubit.save(),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Map<String, List<PublicField>> _groupFields(List<PublicField> fields) {
    final sections = <String, List<PublicField>>{};

    for (final field in fields) {
      final section = _sectionForKey(field.key);
      sections.putIfAbsent(section, () => []).add(field);
    }

    return sections;
  }

  String _sectionForKey(String key) {
    if (key.startsWith('public.hero')) return 'The first screen';
    if (key.startsWith('public.show') || key.startsWith('public.feature')) {
      return 'What the Institute does well';
    }
    if (key.startsWith('public.video')) return 'Videos';
    if (key.startsWith('public.image')) return 'Photographs';
    if (key.startsWith('public.news')) return 'Notices';
    if (key.startsWith('public.programme')) return 'Programmes';
    if (key.startsWith('public.verify')) return 'Certificate verification';
    if (key.startsWith('public.closing')) return 'Closing';
    if (key.startsWith('public.youtube') ||
        key.startsWith('public.tiktok') ||
        key.startsWith('public.facebook') ||
        key.startsWith('public.instagram') ||
        key == 'public.tagline') {
      return 'Name and channels';
    }
    return 'Also on this page';
  }
}

// ── Editor section ──

class _EditorSection extends StatelessWidget {
  const _EditorSection({
    required this.title,
    required this.fields,
    required this.dark,
    required this.cubit,
  });

  final String title;
  final List<PublicField> fields;
  final bool dark;
  final PublicPageCubit cubit;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 12),
          ...fields.map((field) => _FieldEditor(
                field: field,
                dark: dark,
                cubit: cubit,
              )),
        ],
      ),
    );
  }
}

// ── Field editor ──

class _FieldEditor extends StatelessWidget {
  const _FieldEditor({
    required this.field,
    required this.dark,
    required this.cubit,
  });

  final PublicField field;
  final bool dark;
  final PublicPageCubit cubit;

  @override
  Widget build(BuildContext context) {
    final value = cubit.currentValue(field.key);
    final isOverridden = field.isOverridden || cubit.state.draft.containsKey(field.key);
    final error = cubit.state.fieldErrors[field.key];

    Widget fieldWidget;

    if (field.type == 'boolean') {
      fieldWidget = _SwitchField(
        field: field,
        value: value == true,
        dark: dark,
        onChanged: (v) => cubit.setDraft(field.key, v),
      );
    } else if (field.type == 'string[]') {
      fieldWidget = _StringListField(
        field: field,
        value: value is List ? List<String>.from(value.map((e) => e.toString())) : [],
        dark: dark,
        onChanged: (v) => cubit.setDraft(field.key, v),
      );
    } else {
      fieldWidget = _TextField(
        field: field,
        value: value?.toString() ?? '',
        dark: dark,
        error: error,
        onChanged: (v) => cubit.setDraft(field.key, v),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          fieldWidget,
          // Restore button
          if (isOverridden)
            TextButton.icon(
              onPressed: () => cubit.restoreDefault(field.key),
              icon: const Icon(Icons.restore, size: 14),
              label: const Text('Restore default'),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
              ),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                error,
                style: const TextStyle(color: AppColors.error, fontSize: 11),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Text field ──

class _TextField extends StatelessWidget {
  const _TextField({
    required this.field,
    required this.value,
    required this.dark,
    required this.onChanged,
    this.error,
  });

  final PublicField field;
  final String value;
  final bool dark;
  final ValueChanged<String> onChanged;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final ctrl = TextEditingController(text: value);
    final charCount = value.length;
    final overLimit = field.maxLength != null && charCount > field.maxLength!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _labelForKey(field.key),
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
            fontSize: 13,
          ),
        ),
        const SizedBox(height: 4),
        if (field.description.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              field.description,
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 11,
              ),
            ),
          ),
        TextFormField(
          controller: ctrl,
          maxLines: field.multiline ? 4 : 1,
          onChanged: onChanged,
          decoration: InputDecoration(
            counterText: field.maxLength != null
                ? '$charCount/${field.maxLength}'
                : null,
            counterStyle: TextStyle(
              color: overLimit ? AppColors.error : (dark ? AppColorsDark.muted : AppColors.muted),
              fontSize: 11,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            errorText: error,
          ),
        ),
      ],
    );
  }
}

// ── Switch field ──

class _SwitchField extends StatelessWidget {
  const _SwitchField({
    required this.field,
    required this.value,
    required this.dark,
    required this.onChanged,
  });

  final PublicField field;
  final bool value;
  final bool dark;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _labelForKey(field.key),
                style: TextStyle(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                  fontWeight: FontWeight.w500,
                  fontSize: 13,
                ),
              ),
              if (field.description.isNotEmpty)
                Text(
                  field.description,
                  style: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                    fontSize: 11,
                  ),
                ),
            ],
          ),
        ),
        Switch(
          value: value,
          onChanged: onChanged,
        ),
      ],
    );
  }
}

// ── String list field ──

class _StringListField extends StatelessWidget {
  const _StringListField({
    required this.field,
    required this.value,
    required this.dark,
    required this.onChanged,
  });

  final PublicField field;
  final List<String> value;
  final bool dark;
  final ValueChanged<List<String>> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _labelForKey(field.key),
          style: TextStyle(
            color: dark ? AppColorsDark.ink : AppColors.ink,
            fontWeight: FontWeight.w500,
            fontSize: 13,
          ),
        ),
        if (field.description.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(
              field.description,
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 11,
              ),
            ),
          ),
        ...value.asMap().entries.map((entry) {
          final i = entry.key;
          final url = entry.value;
          return Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                Expanded(
                  child: TextFormField(
                    initialValue: url,
                    onChanged: (v) {
                      final newList = List<String>.from(value);
                      newList[i] = v;
                      onChanged(newList);
                    },
                    decoration: InputDecoration(
                      hintText: 'URL',
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(AppRadius.sm),
                      ),
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 16),
                  onPressed: () {
                    final newList = List<String>.from(value);
                    newList.removeAt(i);
                    onChanged(newList);
                  },
                ),
              ],
            ),
          );
        }),
        TextButton.icon(
          onPressed: () => onChanged([...value, '']),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('Add'),
        ),
      ],
    );
  }
}

// ── Readonly field ──

class _ReadonlyField extends StatelessWidget {
  const _ReadonlyField({
    required this.label,
    required this.value,
    required this.dark,
  });

  final String label;
  final String value;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w500,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Save bar ──

class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.changeCount,
    required this.saving,
    required this.dark,
    required this.onSave,
  });

  final int changeCount;
  final bool saving;
  final bool dark;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border(
          top: BorderSide(color: dark ? AppColorsDark.line : AppColors.line),
        ),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: changeCount > 0 && !saving ? onSave : null,
            child: saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(changeCount > 0
                    ? 'Save $changeCount change(s)'
                    : 'No changes'),
          ),
        ),
      ),
    );
  }
}

String _labelForKey(String key) {
  final parts = key.split('.');
  if (parts.length < 2) return key;
  final name = parts.last;
  // Convert camelCase to Title Case
  return name
      .replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m.group(1)}')
      .trim()
      .split(' ')
      .map((w) => w[0].toUpperCase() + w.substring(1))
      .join(' ');
}
