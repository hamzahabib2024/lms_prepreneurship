import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/repositories/auth_repository.dart';
import 'forgot_password_page.dart';
import 'widgets/auth_brand_panel.dart';

/// SETTING THE NEW PASSWORD, from the emailed link — FR-AUT.
///
/// The token arrives via deep link and is sent straight back; nothing is
/// stored, and it is never put in persistent storage. It is a credential for
/// the next few minutes, and a credential that outlives the device it arrived
/// on is one somebody finds later on a device they had forgotten they were
/// signed into.
///
/// THE PASSWORD IS TYPED TWICE. A single box plus a reveal button is the
/// fashionable arrangement and it is the wrong one here: there is no "current
/// password" to fall back on if a typo goes through, so the account would be
/// locked out by a slip. Two boxes catch that before it costs anybody a second
/// email.
class ResetPasswordPage extends StatefulWidget {
  const ResetPasswordPage({
    super.key,
    required this.api,
    required this.token,
  });

  final ApiClient api;
  final String token;

  @override
  State<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends State<ResetPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();
  final _againController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureAgain = true;
  bool _busy = false;
  ApiException? _error;
  bool _done = false;

  late final AuthRepository _repository;

  @override
  void initState() {
    super.initState();
    _repository = AuthRepository(api: widget.api);
  }

  @override
  void dispose() {
    _passwordController.dispose();
    _againController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final isValid = _formKey.currentState?.validate() ?? false;
    if (!isValid) return;
    if (_passwordController.text != _againController.text) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _repository.resetPassword(
        token: widget.token,
        newPassword: _passwordController.text,
      );
      if (!mounted) return;
      setState(() => _done = true);
      // Straight to signing in, but only after they have read that it worked —
      // landing on the login form with no explanation looks like a failure.
      Timer(const Duration(milliseconds: 2500), () {
        if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final wide = MediaQuery.sizeOf(context).width >= 700;

    final hasToken = widget.token.isNotEmpty;

    final card = Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Choose a new password',
            style: TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.4,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
          ),
          const SizedBox(height: 20),
          if (!hasToken) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.errorBg : AppColors.errorBg,
                border: Border.all(
                  color: (dark ? AppColorsDark.error : AppColors.error).withValues(alpha: 0.3),
                ),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'That link is incomplete',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: dark ? AppColorsDark.error : AppColors.error,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'It may have been cut short by your email program. Copy the whole address from '
                    'the message, or ask for a new link.',
                    style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 44,
              child: FilledButton(
                onPressed: () {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) => ForgotPasswordPage(api: widget.api),
                    ),
                  );
                },
                child: const Text('Ask for a new link'),
              ),
            ),
          ] else if (_done) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.okBg : AppColors.okBg,
                border: Border.all(
                  color: (dark ? AppColorsDark.ok : AppColors.ok).withValues(alpha: 0.3),
                ),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Your password has been changed',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: dark ? AppColorsDark.ok : AppColors.ok,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Taking you to the sign-in page. Use the new password there.',
                    style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                  ),
                ],
              ),
            ),
          ] else ...[
            if (_error != null) ...[
              AppAlert(
                title: 'Could not reset',
                message: _error!.message,
                reference: _error!.reference,
                details: serverDetailLines(_error!),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) => ForgotPasswordPage(api: widget.api),
                    ),
                  );
                },
                child: const Text('Ask for a new link'),
              ),
              const SizedBox(height: 6),
            ],
            _FieldLabel('New password'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _passwordController,
              obscureText: _obscurePassword,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.next,
              autofocus: true,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Password is required';
                }
                return null;
              },
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscurePassword
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    size: 20,
                  ),
                  onPressed: () =>
                      setState(() => _obscurePassword = !_obscurePassword),
                ),
              ),
            ),
            const SizedBox(height: 16),
            _FieldLabel('Type it again'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _againController,
              obscureText: _obscureAgain,
              autofillHints: const [AutofillHints.newPassword],
              textInputAction: TextInputAction.done,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please confirm your password';
                }
                if (value != _passwordController.text) {
                  return 'The two do not match.';
                }
                return null;
              },
              onChanged: (_) => setState(() {}),
              onFieldSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscureAgain
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    size: 20,
                  ),
                  onPressed: () =>
                      setState(() => _obscureAgain = !_obscureAgain),
                ),
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 44,
              child: FilledButton(
                onPressed: _busy ||
                        _passwordController.text.isEmpty ||
                        _passwordController.text != _againController.text
                    ? null
                    : _submit,
                child: _busy
                    ? const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor:
                                  AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          ),
                          SizedBox(width: 10),
                          Text('Saving…'),
                        ],
                      )
                    : const Text('Set this password'),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Everything signed in to this account elsewhere is signed out when you do this.',
              style: TextStyle(fontSize: 12.5, color: muted),
            ),
          ],
        ],
      ),
    );

    return Scaffold(
      body: SafeArea(
        child: wide
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Expanded(flex: 11, child: AuthBrandPanel(compact: false)),
                  Expanded(
                    flex: 10,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(32),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 400),
                          child: _AuthCard(child: card),
                        ),
                      ),
                    ),
                  ),
                ],
              )
            : SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const AuthBrandPanel(compact: true),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
                      child: Transform.translate(
                        offset: const Offset(0, -14),
                        child: _AuthCard(child: card),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _AuthCard extends StatelessWidget {
  const _AuthCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : AppColors.surface,
        border: Border.all(color: dark ? AppColorsDark.line : AppColors.line),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: AppShadow.floating,
      ),
      child: child,
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Text(
      text,
      style: TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w600,
        color: dark ? AppColorsDark.ink2 : AppColors.ink2,
      ),
    );
  }
}
