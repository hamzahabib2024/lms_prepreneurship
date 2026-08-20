import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';

/// The admission forms' controls — Material fields with a deliberate look:
/// rounded, softly filled, hairline borders that turn brand-coloured on focus.
/// Kept in one file so the apply form and the review form cannot drift apart.

InputDecoration _decoration(BuildContext context, String? hint, {bool hasError = false}) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  final muted = dark ? AppColorsDark.muted : AppColors.muted;
  final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;
  final error = dark ? AppColorsDark.error : AppColors.error;
  final line = dark ? AppColorsDark.line : AppColors.line;
  final fill = dark ? AppColorsDark.surface2 : Colors.white;

  return InputDecoration(
    hintText: hint,
    hintStyle: TextStyle(color: muted, fontSize: 14.5),
    filled: true,
    fillColor: fill,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: hasError ? error : line),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.sm),
      borderSide: BorderSide(color: hasError ? error : brand, width: 1.6),
    ),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.sm)),
    counterText: hasError ? '' : null,
  );
}

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

/// A labelled text field. The hint — when there is one — is helper text
/// shown once, beneath the field, never also as an in-field placeholder, so
/// a half-typed value can never be mistaken for a prompt (FR-REG-018).
class AdmissionFormField extends StatelessWidget {
  const AdmissionFormField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.hint,
    this.errorText,
    this.keyboardType,
    this.maxLength,
    this.maxLines = 1,
  });

  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final String? hint;

  /// Shown in red beneath the field instead of the hint; the form's own
  /// pre-submission check, so a server rejection is not the first time a
  /// person hears about a bad value.
  final String? errorText;
  final TextInputType? keyboardType;
  final int? maxLength;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;
    final error = dark ? AppColorsDark.error : AppColors.error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (label.isNotEmpty) ...[
          _FieldLabel(label),
          const SizedBox(height: 8),
        ],
        TextField(
          controller: TextEditingController(text: value)
            ..selection = TextSelection.collapsed(offset: value.length),
          keyboardType: keyboardType,
          maxLines: maxLines,
          maxLength: maxLength,
          style: TextStyle(fontSize: 15, color: ink),
          cursorColor: brand,
          decoration: _decoration(context, null, hasError: errorText != null),
          onChanged: onChanged,
        ),
        if (errorText != null) ...[
          const SizedBox(height: 6),
          Text(
            errorText!,
            style: TextStyle(fontSize: 12, color: error, fontWeight: FontWeight.w500),
          ),
        ] else if (hint != null && hint!.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(hint!, style: TextStyle(fontSize: 12, color: muted)),
        ],
      ],
    );
  }
}

/// A dropdown matched to the text fields beside it.
class AdmissionSelectField extends StatelessWidget {
  const AdmissionSelectField({
    super.key,
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (label.isNotEmpty) ...[
          _FieldLabel(label),
          const SizedBox(height: 6),
        ],
        DropdownButtonFormField<String>(
          initialValue: value.isEmpty ? null : value,
          isExpanded: true,
          hint: Text(hint, style: TextStyle(color: muted, fontSize: 14.5)),
          icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 22),
          iconEnabledColor: muted,
          style: TextStyle(fontSize: 15, color: ink),
          dropdownColor: dark ? AppColorsDark.surface2 : Colors.white,
          menuMaxHeight: 340,
          decoration: _decoration(context, null),
          items: [
            for (final (v, label) in options)
              DropdownMenuItem(value: v, child: Text(label, overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ],
    );
  }
}

/// A date box that opens the Material calendar.
class AdmissionDateField extends StatelessWidget {
  const AdmissionDateField({
    super.key,
    required this.label,
    required this.value,
    required this.hint,
    required this.firstDate,
    required this.lastDate,
    this.initialDate,
    required this.onChanged,
  });

  final String label;
  final DateTime? value;
  final String hint;
  final DateTime firstDate;
  final DateTime lastDate;

  /// Where the calendar opens when [value] is unset — today by default.
  final DateTime? initialDate;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final ink = dark ? AppColorsDark.ink : AppColors.ink;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FieldLabel(label),
        const SizedBox(height: 6),
        InkWell(
          onTap: () async {
            final picked = await showDatePicker(
              context: context,
              // Open on the current value, otherwise on today — never on the
              // far end of a wide range, which stranded the calendar two
              // years out and made future dates look unreachable.
              initialDate: _pickerInitial(),
              firstDate: firstDate,
              lastDate: lastDate,
            );
            if (picked != null) onChanged(picked);
          },
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: InputDecorator(
            decoration: _decoration(context, null),
            child: Row(
              children: [
                Icon(Icons.calendar_today_rounded, size: 16, color: muted),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    value == null
                        ? hint
                        : '${value!.day} ${_month(value!.month)} ${value!.year}',
                    style: TextStyle(
                      fontSize: 15,
                      color: value == null ? muted : ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The value, else [initialDate], else today — always clamped to the
  /// pickable range (Material throws on an out-of-range initial date).
  DateTime _pickerInitial() {
    final now = DateTime.now();
    final candidate = value ?? initialDate ?? now;
    if (candidate.isBefore(firstDate)) return firstDate;
    if (candidate.isAfter(lastDate)) return lastDate;
    return candidate;
  }

  static String _month(int m) =>
      const ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
}