import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../data/repositories/auth_repository.dart';

/// A reusable bottom-sheet dialog that re-authenticates the user before
/// sensitive operations (password changes, financial approvals, impersonation).
///
/// Call [StepUpPrompt.show] from any screen. Returns `true` if the step-up
/// succeeded within the 10-minute window, `false` if the user cancelled or
/// entered wrong credentials.
class StepUpPrompt {
  const StepUpPrompt._();

  /// Shows the step-up dialog and returns `true` on success.
  static Future<bool> show(
    BuildContext context, {
    required String email,
  }) {
    final api = context.read<ApiClient>();
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => RepositoryProvider.value(
        value: api,
        child: _StepUpSheet(email: email),
      ),
    ).then((v) => v ?? false);
  }
}

class _StepUpSheet extends StatefulWidget {
  const _StepUpSheet({required this.email});

  final String email;

  @override
  State<_StepUpSheet> createState() => _StepUpSheetState();
}

class _StepUpSheetState extends State<_StepUpSheet> {
  final _passwordController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final password = _passwordController.text;
    if (password.isEmpty) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      await AuthRepository(api: api).stepUp(
        email: widget.email,
        password: password,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() {
        _busy = false;
        _error = 'Incorrect password. Please try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
        decoration: BoxDecoration(
          color: dark ? AppColorsDark.surface : AppColors.surface,
          borderRadius:
              const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: dark ? AppColorsDark.lineStrong : AppColors.lineStrong,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Icon(
                    Icons.shield_outlined,
                    size: 22,
                    color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Confirm your identity',
                      style: TextStyle(
                        fontFamily: AppFonts.display,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.36,
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'This action requires re-authentication. Enter your password to continue.',
                style: TextStyle(
                  fontSize: 13.5,
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
              ),
              const SizedBox(height: 20),
              TextField(
                controller: _passwordController,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: 'Password',
                  hintText: 'Your current password',
                  errorText: _error,
                ),
                textInputAction: TextInputAction.go,
                onSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed:
                          _busy ? null : () => Navigator.of(context).pop(false),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Confirm'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
