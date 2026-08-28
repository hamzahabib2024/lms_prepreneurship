import 'package:flutter/material.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/ui.dart';
import '../data/repositories/auth_repository.dart';
import 'widgets/auth_brand_panel.dart';

/// "I HAVE FORGOTTEN MY PASSWORD" — FR-AUT.
///
/// Two steps on one screen: say who you are, confirm you meant it, and then be
/// told to go and look in your email. The confirmation is not ceremony — asking
/// for a reset ENDS EVERY SESSION on that account once it is used, and somebody
/// who pressed it by accident on a shared device should get the chance to stop.
class ForgotPasswordPage extends StatefulWidget {
  const ForgotPasswordPage({super.key, required this.api});

  final ApiClient api;

  @override
  State<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends State<ForgotPasswordPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _confirming = false;
  String? _sent;
  bool _busy = false;
  ApiException? _error;

  late final AuthRepository _repository;

  @override
  void initState() {
    super.initState();
    _repository = AuthRepository(api: widget.api);
  }

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final message = await _repository.forgotPassword(
        email: _emailController.text,
      );
      if (!mounted) return;
      setState(() {
        _sent = message;
        _confirming = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.status == 429
            ? ApiException(
                status: 429,
                message:
                    'A link has already been sent to that address a few times in the last hour. '
                    'Check the inbox and the spam folder — the most recent one is the one that '
                    'works. If none arrived, ask the office to reset it for you rather than waiting.',
              )
            : error;
        _confirming = false;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;
    final wide = MediaQuery.sizeOf(context).width >= 700;

    final card = Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Forgotten your password',
            style: TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.4,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'We will email you a link for setting a new one.',
            style: TextStyle(color: muted, fontSize: 14.5),
          ),
          const SizedBox(height: 20),
          if (_sent != null) ...[
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
                    'Check your email',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: dark ? AppColorsDark.ok : AppColors.ok,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _sent!,
                    style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Sent to ${_emailController.text.trim()}.',
              style: const TextStyle(fontSize: 13.5),
            ),
            const SizedBox(height: 8),
            Text(
              'It may take a minute to arrive, and it may land in the spam folder. The link '
              'works once and stops working after 30 minutes — ask again from here if it expires.',
              style: TextStyle(fontSize: 12.5, color: muted, height: 1.5),
            ),
            const SizedBox(height: 16),
            SizedBox(
              height: 44,
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Back to signing in'),
              ),
            ),
          ] else if (_confirming) ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.warnBg : AppColors.warnBg,
                border: Border.all(
                  color: (dark ? AppColorsDark.warn : AppColors.warn).withValues(alpha: 0.3),
                ),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Send the link to ${_emailController.text.trim()}?',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: dark ? AppColorsDark.warn : AppColors.warn,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'We will check that address belongs to an account and, if it does, email a '
                    'link for choosing a new password. Using it signs that account out everywhere.',
                    style: TextStyle(fontSize: 13.5, color: muted, height: 1.5),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: FilledButton(
                      onPressed: _busy ? null : _send,
                      child: _busy
                          ? const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                  ),
                                ),
                                SizedBox(width: 10),
                                Text('Sending…'),
                              ],
                            )
                          : const Text('Yes, send it'),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() => _confirming = false),
                      child: const Text('Cancel'),
                    ),
                  ),
                ),
              ],
            ),
          ] else ...[
            if (_error != null) ...[
              AppAlert(
                title: _error!.status == 429 ? 'Too many attempts' : 'Could not send',
                message: _error!.message,
                reference: _error!.reference,
                warn: true,
              ),
              const SizedBox(height: 14),
            ],
            _FieldLabel('Your email address'),
            const SizedBox(height: 6),
            TextFormField(
              controller: _emailController,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.username],
              textInputAction: TextInputAction.done,
              autofocus: true,
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Email is required';
                }
                return null;
              },
              onFieldSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 6),
            Text(
              'The address the Institute has for you. If you are not sure which it is, ask the office.',
              style: TextStyle(fontSize: 12, color: muted, height: 1.4),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 44,
              child: FilledButton(
                onPressed: (_busy || _emailController.text.trim().isEmpty)
                    ? null
                    : _submit,
                child: const Text('Continue'),
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Back to signing in'),
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

  void _submit() {
    if (_busy) return;
    final isValid = _formKey.currentState?.validate() ?? false;
    if (!isValid) return;
    setState(() => _confirming = true);
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
