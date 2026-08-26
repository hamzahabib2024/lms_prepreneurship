import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../cubit/admin_cubit.dart';
import '../../data/models/user_directory_item.dart';

class UserDetailPage extends StatelessWidget {
  const UserDetailPage({super.key, required this.user});

  final UserDirectoryItem user;

  @override
  Widget build(BuildContext context) {
    return BlocListener<AdminCubit, AdminState>(
      listenWhen: (prev, curr) =>
          prev.actionSuccess != curr.actionSuccess ||
          prev.actionError != curr.actionError ||
          prev.passwordResetResult != curr.passwordResetResult ||
          prev.personalDataExport != curr.personalDataExport,
      listener: (context, state) {
        if (state.actionSuccess != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.actionSuccess!)),
          );
          context.read<AdminCubit>().dismissResult();
        }
        if (state.actionError != null) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.actionError!.message)),
          );
          context.read<AdminCubit>().dismissResult();
        }
        if (state.passwordResetResult != null) {
          _showPasswordResetDialog(context, state.passwordResetResult!.temporaryPassword);
          context.read<AdminCubit>().dismissResult();
        }
        if (state.personalDataExport != null) {
          _showDataExportDialog(context, state.personalDataExport!);
          context.read<AdminCubit>().clearPersonalDataExport();
        }
      },
      child: Builder(
        builder: (context) {
          final dark = Theme.of(context).brightness == Brightness.dark;
          final muted = dark ? AppColorsDark.muted : AppColors.muted;

          return Scaffold(
            appBar: AppBar(
              title: Text(user.fullName),
              backgroundColor: Theme.of(context).colorScheme.surface,
              surfaceTintColor: Colors.transparent,
            ),
            body: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: dark ? AppColorsDark.brand050 : AppColors.brand050,
                      child: Text(
                        user.fullName.isNotEmpty ? user.fullName[0].toUpperCase() : '?',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                          color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(user.fullName, style: Theme.of(context).textTheme.titleMedium),
                          const SizedBox(height: 2),
                          Text(user.email, style: TextStyle(fontSize: 13, color: muted)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                _InfoSection(title: 'Account', children: [
                  _InfoRow('Status', _StatusPill(status: user.status)),
                  _InfoRow('Roles', Text(
                    user.roles.map(_roleLabel).join(', '),
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                  )),
                  if (user.subPermissions.isNotEmpty)
                    _InfoRow('Permissions', Text(
                      user.subPermissions.map(_permLabel).join(', '),
                      style: const TextStyle(fontSize: 13, color: AppColors.accent600),
                    )),
                  if (user.lastLoginAt != null)
                    _InfoRow('Last login', Text(
                      _formatDate(user.lastLoginAt!),
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                    )),
                  if (user.mustChangePassword)
                    _InfoRow('Password', Pill(text: 'Must change', kind: PillKind.warn)),
                ]),
                const SizedBox(height: 16),
                if (user.phone != null || user.registrationNo != null || user.employeeCode != null)
                  _InfoSection(title: 'Details', children: [
                    if (user.phone != null)
                      _InfoRow('Phone', Text(user.phone!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600))),
                    if (user.registrationNo != null)
                      _InfoRow('Registration', Text(user.registrationNo!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, fontFamily: 'monospace'))),
                    if (user.employeeCode != null)
                      _InfoRow('Employee code', Text(user.employeeCode!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600))),
                  ]),
                const SizedBox(height: 20),
                Text('Actions', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                if (user.status == 'ACTIVE') ...[
                  _ActionButton(
                    label: 'Suspend account',
                    icon: Icons.block_outlined,
                    destructive: true,
                    onTap: () => _confirmSuspend(context),
                  ),
                  const SizedBox(height: 8),
                ],
                if (user.status == 'SUSPENDED') ...[
                  _ActionButton(
                    label: 'Reactivate account',
                    icon: Icons.check_circle_outline,
                    onTap: () => _confirmReactivate(context),
                  ),
                  const SizedBox(height: 8),
                ],
                if (user.status == 'LOCKED') ...[
                  _ActionButton(
                    label: 'Unlock account',
                    icon: Icons.lock_open_outlined,
                    onTap: () => _confirmUnlock(context),
                  ),
                  const SizedBox(height: 8),
                ],
                _ActionButton(
                  label: 'Reset password',
                  icon: Icons.vpn_key_outlined,
                  onTap: () => _confirmResetPassword(context),
                ),
                const SizedBox(height: 8),
                if (user.status != 'SUSPENDED')
                  _ActionButton(
                    label: 'Revoke all sessions',
                    icon: Icons.exit_to_app_outlined,
                    onTap: () => _confirmRevokeSessions(context),
                  ),
                const SizedBox(height: 8),
                _ActionButton(
                  label: 'Impersonate user',
                  icon: Icons.switch_account_outlined,
                  onTap: () => _confirmImpersonate(context),
                ),
                const SizedBox(height: 8),
                _ActionButton(
                  label: 'Export personal data',
                  icon: Icons.download_outlined,
                  onTap: () {
                    context.read<AdminCubit>().exportPersonalData(userId: user.id);
                  },
                ),
                const SizedBox(height: 8),
                _ActionButton(
                  label: 'Erase personal data',
                  icon: Icons.delete_forever_outlined,
                  destructive: true,
                  onTap: () => _confirmEraseData(context),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _confirmSuspend(BuildContext context) {
    final reasonController = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Suspend account'),
          content: TextField(
            controller: reasonController,
            decoration: const InputDecoration(
              labelText: 'Reason (required)',
              hintText: 'Describe why this account is being suspended',
            ),
            maxLines: 3,
            onChanged: (_) => setDialogState(() {}),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: reasonController.text.trim().length >= 5
                  ? () {
                      Navigator.of(ctx).pop();
                      context.read<AdminCubit>().suspendUser(
                            id: user.id,
                            reason: reasonController.text.trim(),
                          );
                    }
                  : null,
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(ctx).colorScheme.error,
              ),
              child: const Text('Suspend'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmReactivate(BuildContext context) {
    final reasonController = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Reactivate account'),
          content: TextField(
            controller: reasonController,
            decoration: const InputDecoration(
              labelText: 'Reason (required)',
            ),
            maxLines: 2,
            onChanged: (_) => setDialogState(() {}),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: reasonController.text.trim().length >= 5
                  ? () {
                      Navigator.of(ctx).pop();
                      context.read<AdminCubit>().reactivateUser(
                            id: user.id,
                            reason: reasonController.text.trim(),
                          );
                    }
                  : null,
              child: const Text('Reactivate'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmUnlock(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Unlock account'),
        content: const Text(
          'This clears the failed-attempt counter and restores access. '
          'The user can sign in with their existing password.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().unlockAccount(id: user.id);
            },
            child: const Text('Unlock'),
          ),
        ],
      ),
    );
  }

  void _confirmResetPassword(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset password'),
        content: const Text(
          'A temporary password will be generated and all active sessions '
          'will be ended. The user must set a new password on next sign-in.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().resetPassword(id: user.id);
            },
            child: const Text('Reset password'),
          ),
        ],
      ),
    );
  }

  void _confirmRevokeSessions(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Revoke all sessions'),
        content: const Text(
          'The user will be signed out from all devices. '
          'They will need to sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().revokeSessions(id: user.id);
            },
            child: const Text('Revoke sessions'),
          ),
        ],
      ),
    );
  }

  void _confirmImpersonate(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Impersonate user?'),
        content: Text(
          'You will be logged in as ${user.fullName}. '
          'All actions will be recorded in the audit log under your name. '
          'Restart the app to stop impersonating.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.read<AdminCubit>().impersonate(userId: user.id);
            },
            child: const Text('Impersonate'),
          ),
        ],
      ),
    );
  }

  void _confirmEraseData(BuildContext context) {
    final confirmController = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Erase personal data?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'This will permanently delete all personal data for this user. '
                'This action cannot be undone.',
                style: TextStyle(fontSize: 13.5),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: confirmController,
                decoration: const InputDecoration(
                  labelText: 'Type ERASE to confirm',
                ),
                onChanged: (_) => setDialogState(() {}),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: confirmController.text.trim() == 'ERASE'
                  ? () {
                      Navigator.of(ctx).pop();
                      context.read<AdminCubit>().erasePersonalData(userId: user.id);
                    }
                  : null,
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(ctx).colorScheme.error,
              ),
              child: const Text('Erase data'),
            ),
          ],
        ),
      ),
    );
  }

  void _showPasswordResetDialog(BuildContext context, String password) {
    showDialog<void>(
      context: context,
      builder: (ctx) {
        final dark = Theme.of(ctx).brightness == Brightness.dark;
        return AlertDialog(
          title: const Text('Temporary password'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
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
                child: SelectableText(
                  password,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.5,
                    color: dark ? AppColorsDark.warn : AppColors.warn,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Shown once. The user will be asked to set their own password on next sign-in.',
                style: TextStyle(fontSize: 12.5, color: dark ? AppColorsDark.muted : AppColors.muted),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: password));
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(content: Text('Password copied')),
                );
              },
              child: const Text('Copy'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Done'),
            ),
          ],
        );
      },
    );
  }

  void _showDataExportDialog(BuildContext context, Map<String, dynamic> data) {
    final jsonStr = const JsonEncoder.withIndent('  ').convert(data);
    showDialog<void>(
      context: context,
      builder: (ctx) {
        final dark = Theme.of(ctx).brightness == Brightness.dark;
        return AlertDialog(
          title: const Text('Personal Data Export'),
          content: SizedBox(
            width: double.maxFinite,
            height: 400,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.surface2 : AppColors.surface2,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: SingleChildScrollView(
                child: SelectableText(
                  jsonStr,
                  style: const TextStyle(
                    fontSize: 11,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: jsonStr));
                ScaffoldMessenger.of(ctx).showSnackBar(
                  const SnackBar(content: Text('Data copied to clipboard')),
                );
              },
              child: const Text('Copy'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  static String _roleLabel(String role) => switch (role) {
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'teacher' => 'Teacher',
        'student' => 'Student',
        _ => role,
      };

  static String _permLabel(String perm) => switch (perm) {
        'admin_manager' => 'Admin Manager',
        'financial_reporter' => 'Financial Reporter',
        'bulk_operator' => 'Bulk Operator',
        'certificate_issuer' => 'Certificate Issuer',
        _ => perm,
      };

  static String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (bg, fg) = switch (status) {
      'ACTIVE' => (dark ? AppColorsDark.okBg : AppColors.okBg, dark ? AppColorsDark.ok : AppColors.ok),
      'SUSPENDED' => (dark ? AppColorsDark.errorBg : AppColors.errorBg, dark ? AppColorsDark.error : AppColors.error),
      'LOCKED' => (dark ? AppColorsDark.warnBg : AppColors.warnBg, dark ? AppColorsDark.warn : AppColors.warn),
      _ => (dark ? AppColorsDark.surface2 : AppColors.surface2, dark ? AppColorsDark.muted : AppColors.muted),
    };
    final label = switch (status) {
      'ACTIVE' => 'Active',
      'SUSPENDED' => 'Suspended',
      'LOCKED' => 'Locked',
      'INVITED' => 'Invited',
      _ => status,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

class _InfoSection extends StatelessWidget {
  const _InfoSection({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface2 : AppColors.surface2,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          for (final child in children) ...[
            child,
            if (child != children.last) const SizedBox(height: 8),
          ],
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final Widget value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(label, style: TextStyle(fontSize: 12.5, color: dark ? AppColorsDark.muted : AppColors.muted)),
        ),
        Expanded(child: value),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.label,
    required this.icon,
    this.destructive = false,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool destructive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = destructive
        ? (dark ? AppColorsDark.error : AppColors.error)
        : (dark ? AppColorsDark.ink : AppColors.ink);

    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18, color: color),
        label: Text(label, style: TextStyle(color: color)),
        style: OutlinedButton.styleFrom(
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        ),
      ),
    );
  }
}
