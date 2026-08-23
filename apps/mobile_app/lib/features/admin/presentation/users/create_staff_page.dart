import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/models/staff_creation_result.dart';

class CreateStaffPage extends StatefulWidget {
  const CreateStaffPage({super.key});

  @override
  State<CreateStaffPage> createState() => _CreateStaffPageState();
}

class _CreateStaffPageState extends State<CreateStaffPage> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _employeeCodeController = TextEditingController();
  String _role = 'teacher';
  final Set<String> _subPermissions = {};

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _employeeCodeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AdminCubit, AdminState>(
      listenWhen: (prev, curr) =>
          prev.staffCreationResult != curr.staffCreationResult ||
          prev.actionError != curr.actionError,
      listener: (context, state) {
        if (state.staffCreationResult != null) {
          _showReceipt(context, state.staffCreationResult!);
        }
        if (state.actionError != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.actionError!.message)),
          );
          context.read<AdminCubit>().dismissResult();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Create staff account'),
          backgroundColor: Theme.of(context).colorScheme.surface,
          surfaceTintColor: Colors.transparent,
        ),
        body: BlocBuilder<AdminCubit, AdminState>(
          builder: (context, state) {
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Account details', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 14),
                    _FormField(
                      label: 'Full name',
                      controller: _nameController,
                      validator: (v) => (v == null || v.trim().length < 2) ? 'Enter at least 2 characters' : null,
                    ),
                    const SizedBox(height: 12),
                    _FormField(
                      label: 'Email address',
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Required';
                        if (!v.contains('@') || !v.contains('.')) return 'Enter a valid email';
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    _FormField(
                      label: 'Phone (optional)',
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 18),
                    Text('Role', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: _RoleOption(
                            label: 'Teacher',
                            selected: _role == 'teacher',
                            onTap: () => setState(() {
                              _role = 'teacher';
                              _subPermissions.clear();
                            }),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _RoleOption(
                            label: 'Admin',
                            selected: _role == 'admin',
                            onTap: () => setState(() => _role = 'admin'),
                          ),
                        ),
                      ],
                    ),
                    if (_role == 'admin') ...[
                      const SizedBox(height: 16),
                      Text('Sub-permissions', style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 8),
                      for (final perm in _allPermissions)
                        _PermissionTile(
                          label: _permLabel(perm),
                          selected: _subPermissions.contains(perm),
                          onTap: () {
                            setState(() {
                              if (_subPermissions.contains(perm)) {
                                _subPermissions.remove(perm);
                              } else {
                                _subPermissions.add(perm);
                              }
                            });
                          },
                        ),
                    ],
                    if (_role == 'teacher') ...[
                      const SizedBox(height: 14),
                      _FormField(
                        label: 'Employee code (optional)',
                        controller: _employeeCodeController,
                      ),
                    ],
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: state.busy
                            ? null
                            : () {
                                if (_formKey.currentState?.validate() ?? false) {
                                  context.read<AdminCubit>().createStaff(
                                        email: _emailController.text,
                                        fullName: _nameController.text,
                                        phone: _phoneController.text,
                                        role: _role,
                                        subPermissions: _role == 'admin'
                                            ? _subPermissions.toList()
                                            : null,
                                        employeeCode: _role == 'teacher'
                                            ? _employeeCodeController.text
                                            : null,
                                      );
                                }
                              },
                        child: state.busy
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Create account'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  void _showReceipt(BuildContext context, StaffCreationResult result) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Account created'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ReceiptRow('Name', result.fullName),
              _ReceiptRow('Email', result.email),
              _ReceiptRow('Role', result.role == 'teacher' ? 'Teacher' : 'Admin'),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: dark ? AppColorsDark.warnBg : AppColors.warnBg,
                  border: Border.all(
                    color: (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.25),
                  ),
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Temporary password — shown once',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        color: dark ? AppColorsDark.warn : AppColors.warn,
                      ),
                    ),
                    const SizedBox(height: 8),
                    SelectableText(
                      result.temporaryPassword,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.5,
                        color: dark ? AppColorsDark.warn : AppColors.warn,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'The user will be asked to set their own password on first sign-in.',
                      style: TextStyle(fontSize: 12, color: dark ? AppColorsDark.muted : AppColors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Text(
                result.emailSent
                    ? 'Credentials email sent.'
                    : 'Email could not be sent — share the password manually.',
                style: TextStyle(
                  fontSize: 12.5,
                  color: result.emailSent
                      ? (dark ? AppColorsDark.muted : AppColors.muted)
                      : (dark ? AppColorsDark.warn : AppColors.warn),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: result.temporaryPassword));
              ScaffoldMessenger.of(ctx).showSnackBar(
                const SnackBar(content: Text('Password copied')),
              );
            },
            child: const Text('Copy password'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              Navigator.of(context).pop();
            },
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  static const _allPermissions = [
    'admin_manager',
    'financial_reporter',
    'bulk_operator',
    'certificate_issuer',
  ];

  static String _permLabel(String perm) => switch (perm) {
        'admin_manager' => 'Admin Manager',
        'financial_reporter' => 'Financial Reporter',
        'bulk_operator' => 'Bulk Operator',
        'certificate_issuer' => 'Certificate Issuer',
        _ => perm,
      };
}

class _FormField extends StatelessWidget {
  const _FormField({
    required this.label,
    required this.controller,
    this.keyboardType,
    this.validator,
  });

  final String label;
  final TextEditingController controller;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label),
      validator: validator,
    );
  }
}

class _RoleOption extends StatelessWidget {
  const _RoleOption({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final brand = dark ? AppColorsDark.brand600 : AppColors.brand600;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? brand.withValues(alpha: 0.12) : (dark ? AppColorsDark.surface2 : AppColors.surface2),
          borderRadius: BorderRadius.circular(AppRadius.sm),
          border: Border.all(
            color: selected ? brand.withValues(alpha: 0.5) : (dark ? AppColorsDark.line : AppColors.line),
          ),
        ),
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              fontWeight: FontWeight.w600,
              fontSize: 14,
              color: selected ? brand : (dark ? AppColorsDark.ink2 : AppColors.ink2),
            ),
          ),
        ),
      ),
    );
  }
}

class _PermissionTile extends StatelessWidget {
  const _PermissionTile({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Icon(
              selected ? Icons.check_box : Icons.check_box_outline_blank,
              size: 20,
              color: selected
                  ? (dark ? AppColorsDark.brand600 : AppColors.brand600)
                  : (dark ? AppColorsDark.muted : AppColors.muted),
            ),
            const SizedBox(width: 10),
            Text(label, style: const TextStyle(fontSize: 14)),
          ],
        ),
      ),
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  const _ReceiptRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(label, style: TextStyle(fontSize: 12.5, color: muted)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
