import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

/// Cupertino-style form controls shared by the admission pages: wheel-picker
/// dropdowns (the iOS idiom), date pickers and text fields, all themed to the
/// application palette so dark mode keeps working.

/// An iOS wheel-picker sheet, presented from the bottom like iOS settings.
Future<String?> showChoiceSheet(
  BuildContext context, {
  required String title,
  required List<(String, String)> options,
  String selected = '',
}) {
  var index = options.indexWhere((o) => o.$1 == selected);
  if (index < 0) index = 0;
  return _sheet<String>(
    context,
    title: title,
    onDone: () => options.isEmpty ? null : options[index].$1,
    child: SizedBox(
      height: 220,
      child: CupertinoPicker(
        scrollController: FixedExtentScrollController(initialItem: index),
        itemExtent: 44,
        onSelectedItemChanged: (i) => index = i,
        children: [
          for (final (_, label) in options)
            Text(label, maxLines: 2, textAlign: TextAlign.center),
        ],
      ),
    ),
  );
}

/// A date wheel (day/month/year), presented like the picker above.
Future<DateTime?> showDateSheet(
  BuildContext context, {
  required String title,
  required DateTime initial,
  DateTime? minimumDate,
  DateTime? maximumDate,
}) {
  var selected = initial;
  return _sheet<DateTime>(
    context,
    title: title,
    onDone: () => selected,
    child: SizedBox(
      height: 216,
      child: CupertinoDatePicker(
        mode: CupertinoDatePickerMode.date,
        initialDateTime: initial,
        minimumDate: minimumDate,
        maximumDate: maximumDate,
        onDateTimeChanged: (d) => selected = d,
      ),
    ),
  );
}

Future<T?> _sheet<T>(
  BuildContext context, {
  required String title,
  required T? Function() onDone,
  required Widget child,
}) {
  return showCupertinoModalPopup<T>(
    context: context,
    builder: (sheetContext) => CupertinoTheme(
      data: CupertinoThemeData(
        primaryColor: Theme.of(context).colorScheme.primary,
        textTheme: CupertinoTextThemeData(
          textStyle: TextStyle(color: Theme.of(context).colorScheme.onSurface),
        ),
      ),
      child: _SheetScaffold(
        title: title,
        onDone: () => Navigator.of(sheetContext).pop(onDone()),
        child: child,
      ),
    ),
  );
}

class _SheetScaffold extends StatelessWidget {
  const _SheetScaffold({required this.title, required this.onDone, required this.child});

  final String title;
  final VoidCallback onDone;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return SafeArea(
      top: false,
      child: Container(
        decoration: BoxDecoration(
          color: dark ? AppColorsDark.surface : AppColors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Row(
                children: [
                  CupertinoButton(
                    child: const Text('Cancel'),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  Expanded(
                    child: Text(
                      title,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ),
                  CupertinoButton(
                    child: const Text('Done'),
                    onPressed: onDone,
                  ),
                ],
              ),
            ),
            child,
          ],
        ),
      ),
    );
  }
}

// -------------------------------------------------------------- controls ----

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Text(
      label,
      style: TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: dark ? AppColorsDark.ink2 : AppColors.ink2,
      ),
    );
  }
}

/// A labelled iOS text field with a hint beneath it, matching the two pages'
/// existing copy style.
class AdmissionFormField extends StatelessWidget {
  const AdmissionFormField({
    required this.label,
    required this.value,
    required this.onChanged,
    this.hint,
    this.keyboardType,
    this.maxLines = 1,
  });

  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final String? hint;
  final TextInputType? keyboardType;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (label.isNotEmpty) ...[
          _FieldLabel(label),
          const SizedBox(height: 6),
        ],
        CupertinoTextField(
          controller: TextEditingController(text: value)
            ..selection = TextSelection.collapsed(offset: value.length),
          keyboardType: keyboardType,
          maxLines: maxLines,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          style: TextStyle(fontSize: 15, color: ink),
          placeholder: hint,
          placeholderStyle: TextStyle(fontSize: 15, color: muted),
          cursorColor: brand,
          decoration: BoxDecoration(
            border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
            borderRadius: BorderRadius.circular(10),
          ),
          onChanged: onChanged,
        ),
        if (hint != null && hint!.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(hint!, style: TextStyle(fontSize: 12, color: muted)),
        ],
      ],
    );
  }
}

/// A labelled "dropdown": a read-only box that opens the iOS wheel picker.
class AdmissionSelectField extends StatelessWidget {
  const AdmissionSelectField({
    required this.label,
    required this.value,
    required this.hint,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final String value;
  final String hint;
  final List<(String, String)> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final (currentLabel, selected) =
        options.any((o) => o.$1 == value) ? (options.firstWhere((o) => o.$1 == value).$2, true) : (hint, false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (label.isNotEmpty) ...[
          _FieldLabel(label),
          const SizedBox(height: 6),
        ],
        _SelectBox(
          text: currentLabel,
          muted: !selected,
          onTap: () async {
            final picked = await showChoiceSheet(
              context,
              title: label.isEmpty ? 'Choose…' : label,
              options: options,
              selected: value,
            );
            if (picked != null) onChanged(picked);
          },
        ),
      ],
    );
  }
}

/// A labelled date box that opens the date wheel.
class AdmissionDateField extends StatelessWidget {
  const AdmissionDateField({
    required this.label,
    required this.value,
    required this.hint,
    required this.firstDate,
    required this.lastDate,
    required this.onChanged,
  });

  final String label;
  final DateTime? value;
  final String hint;
  final DateTime firstDate;
  final DateTime lastDate;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldLabel(label),
        const SizedBox(height: 6),
        _SelectBox(
          text: value == null ? hint : '${value!.day} ${_month(value!.month)} ${value!.year}',
          muted: value == null,
          onTap: () async {
            final picked = await showDateSheet(
              context,
              title: label,
              initial: value ?? lastDate,
              minimumDate: firstDate,
              maximumDate: lastDate,
            );
            if (picked != null) onChanged(picked);
          },
        ),
      ],
    );
  }

  static String _month(int m) =>
      const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
}

class _SelectBox extends StatelessWidget {
  const _SelectBox({required this.text, required this.muted, required this.onTap});

  final String text;
  final bool muted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final mutedColor = dark ? AppColorsDark.muted : AppColors.muted;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        decoration: BoxDecoration(
          border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                text,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 15, color: muted ? mutedColor : ink),
              ),
            ),
            Icon(
              CupertinoIcons.chevron_down,
              size: 15,
              color: mutedColor,
            ),
          ],
        ),
      ),
    );
  }
}