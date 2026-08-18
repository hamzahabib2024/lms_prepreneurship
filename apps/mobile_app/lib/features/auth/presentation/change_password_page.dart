import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../bloc/auth_bloc.dart';

/// Set a new password — SRS FR-REG-040, SEC-AUT-013.
///
/// A provisioned account arrives with a temporary password that an
/// administrator has read aloud or sent over WhatsApp. Until it is replaced,
/// that password is known to at least two people, so this screen blocks
/// navigation rather than merely suggesting a change. The shell shows it in
/// that forced mode whenever `mustChangePassword` is set.
///
/// It also serves the voluntary case from the profile menu, where the user is
/// not blocked and can cancel — in that mode it is pushed as a route and pops
/// itself back on success.
class ChangePasswordPage extends StatefulWidget {
  const ChangePasswordPage({super.key, required this.forced});

  final bool forced;

  @override
  State<ChangePasswordPage> createState() => _ChangePasswordPageState();
}

class _ChangePasswordPageState extends State<ChangePasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  bool get _mismatch =>
      _confirmController.text.isNotEmpty &&
      _newController.text != _confirmController.text;

  bool get _tooShort => _newController.text.isNotEmpty && _newController.text.length < 8;

  bool get _sameAsCurrent =>
      _newController.text.isNotEmpty && _newController.text == _currentController.text;

  bool get _canSubmit =>
      _currentController.text.isNotEmpty &&
      _newController.text.length >= 8 &&
      !_mismatch &&
      !_sameAsCurrent;

  bool _busy = false;

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final ok = await context.read<AuthBloc>().changePassword(
          currentPassword: _currentController.text,
          newPassword: _newController.text,
        );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok && !widget.forced) {
      // Voluntary change: the user is done, return to where they came from.
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final warnColor = dark ? AppColorsDark.warn : AppColors.warn;

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: BlocBuilder<AuthBloc, AuthState>(
                  builder: (context, state) {
                    final error = state.error;
                    final busy = _busy || state.status == AuthStatus.loading;
                    return Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: dark ? AppColorsDark.surface : AppColors.surface,
                        border: Border.all(
                          color: dark ? AppColorsDark.line : AppColors.line,
                        ),
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                        boxShadow: AppShadow.floating,
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              widget.forced ? 'Set your password' : 'Change your password',
                              style: TextStyle(
                                fontSize: 23,
                                fontWeight: FontWeight.w700,
                                letterSpacing: -0.4,
                                color: dark ? AppColorsDark.ink : AppColors.ink,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              widget.forced
                                  ? 'Your account was created with a temporary password. '
                                      'Choose your own before continuing.'
                                  : 'Choose a new password for your account.',
                              style: TextStyle(color: muted, height: 1.5),
                            ),
                            const SizedBox(height: 20),
                            if (error != null) ...[
                              AppAlert(
                                title: 'Could not change your password',
                                // The server reports every failing field at
                                // once (NFR-ERR-005).
                                message: error.message,
                                reference: error.reference,
                              ),
                              const SizedBox(height: 18),
                            ],
                            Text(
                              widget.forced ? 'Temporary password' : 'Current password',
                              style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: dark ? AppColorsDark.ink2 : AppColors.ink2,
                              ),
                            ),
                            const SizedBox(height: 6),
                            TextFormField(
                              controller: _currentController,
                              obscureText: true,
                              autofillHints: const [AutofillHints.password],
                              textInputAction: TextInputAction.next,
                              validator: (value) {
                                if (value == null || value.isEmpty) {
                                  return 'This field is required';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'New password',
                              style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: dark ? AppColorsDark.ink2 : AppColors.ink2,
                              ),
                            ),
                            const SizedBox(height: 6),
                            TextFormField(
                              controller: _newController,
                              obscureText: true,
                              autofillHints: const [AutofillHints.newPassword],
                              textInputAction: TextInputAction.next,
                              validator: (value) {
                                if (value == null || value.length < 8) {
                                  return 'Use at least 8 characters.';
                                }
                                if (value == _currentController.text) {
                                  return 'Choose something different from your current password.';
                                }
                                return null;
                              },
                              onChanged: (_) => setState(() {}),
                            ),
                            // Guidance is associated with the field and states
                            // the requirement rather than only complaining
                            // after the fact (NFR-ACC-006).
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(
                                _tooShort
                                    ? 'Use at least 8 characters.'
                                    : 'At least 8 characters. Longer is better than complicated.',
                                style: TextStyle(
                                  fontSize: 12.5,
                                  color: _tooShort ? warnColor : muted,
                                ),
                              ),
                            ),
                            if (_sameAsCurrent)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  'Choose something different from your current password.',
                                  style: TextStyle(fontSize: 12.5, color: warnColor),
                                ),
                              ),
                            const SizedBox(height: 16),
                            Text(
                              'Confirm new password',
                              style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: dark ? AppColorsDark.ink2 : AppColors.ink2,
                              ),
                            ),
                            const SizedBox(height: 6),
                            TextFormField(
                              controller: _confirmController,
                              obscureText: true,
                              autofillHints: const [AutofillHints.newPassword],
                              textInputAction: TextInputAction.done,
                              validator: (value) {
                                if (value != _newController.text) {
                                  return 'The two passwords do not match.';
                                }
                                return null;
                              },
                              onChanged: (_) => setState(() {}),
                              onFieldSubmitted: (_) => _submit(),
                            ),
                            if (_mismatch)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text(
                                  'The two passwords do not match.',
                                  style: TextStyle(fontSize: 12.5, color: warnColor),
                                ),
                              ),
                            const SizedBox(height: 22),
                            SizedBox(
                              height: 44,
                              child: FilledButton(
                                onPressed: busy || !_canSubmit ? null : _submit,
                                child: busy
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          valueColor:
                                              AlwaysStoppedAnimation<Color>(Colors.white),
                                        ),
                                      )
                                    : const Text('Save password'),
                              ),
                            ),
                            if (widget.forced) ...[
                              const SizedBox(height: 10),
                              TextButton(
                                // There is no way past this screen except
                                // changing the password or signing out.
                                onPressed: busy
                                    ? null
                                    : () => context
                                        .read<AuthBloc>()
                                        .add(const LogoutRequested()),
                                child: const Text('Sign out instead'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  },
                ),
),
          ),
        ),
      ),
    );
  }
}