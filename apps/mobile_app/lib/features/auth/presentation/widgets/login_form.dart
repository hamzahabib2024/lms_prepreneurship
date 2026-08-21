import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/ui.dart';
import '../../../admission/application/application_page.dart';
import '../../../admission/application/track_application_page.dart';
import 'auth_brand_panel.dart';

/// The sign-in card — ported from the web's LoginPage. The screen is the
/// product's first impression: brand panel on top (collapsed on phones,
/// exactly like the web's 900px breakpoint), then the floating card with the
/// form.
class LoginForm extends StatefulWidget {
  const LoginForm({
    super.key,
    this.error,
    this.lockedOut = false,
    this.suspended = false,
    this.isLoading = false,
    required this.onSignIn,
  });

  final ApiException? error;
  final bool lockedOut;
  final bool suspended;
  final bool isLoading;
  final void Function(String email, String password) onSignIn;

  @override
  State<LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends State<LoginForm> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _submit() {
    if (widget.isLoading) return;
    final isValid = _formKey.currentState?.validate() ?? false;
    if (!isValid) return;
    widget.onSignIn(_emailController.text.trim(), _passwordController.text);
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
            'Welcome back',
            style: TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.4,
              color: dark ? AppColorsDark.ink : AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Sign in to continue',
            style: TextStyle(color: muted, fontSize: 14.5),
          ),
          const SizedBox(height: 20),
          if (widget.error != null) ...[
            AppAlert(
              title: widget.lockedOut
                  ? 'Account locked'
                  : widget.suspended
                      ? 'Account suspended'
                      : 'Could not sign in',
              message: widget.error!.message,
              reference: widget.error!.reference,
              warn: widget.lockedOut || widget.suspended,
            ),
            const SizedBox(height: 18),
          ],
          _FieldLabel('Email address'),
          const SizedBox(height: 6),
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            textInputAction: TextInputAction.next,
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return 'Email is required';
              }
              return null;
            },
            onFieldSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 16),
          _FieldLabel('Password'),
          const SizedBox(height: 6),
          TextFormField(
            controller: _passwordController,
            obscureText: _obscurePassword,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            validator: (value) {
              if (value == null || value.isEmpty) {
                return 'Password is required';
              }
              return null;
            },
            onFieldSubmitted: (_) => _submit(),
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
          const SizedBox(height: 20),
          SizedBox(
            height: 44,
            child: FilledButton(
              onPressed: widget.isLoading ? null : _submit,
              style: FilledButton.styleFrom(
                shadowColor: Colors.transparent,
              ),
              child: widget.isLoading
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
                        Text('Signing in…'),
                      ],
                    )
                  : const Text('Sign in'),
            ),
          ),
          const SizedBox(height: 16),
          // Development accounts, shown only in development builds — the web
          // client shows the same note.
          if (!kReleaseMode)
            Text.rich(
              TextSpan(
                style: TextStyle(fontSize: 12.5, color: muted, height: 1.6),
                children: [
                  const TextSpan(text: 'Development accounts: '),
                  _CodeSpan('admin@institute.local'),
                  const TextSpan(text: ' · '),
                  _CodeSpan('sana@institute.local'),
                  const TextSpan(text: ' — password '),
                  _CodeSpan('ChangeMe!Admin2026'),
                  const TextSpan(text: ' / '),
                  _CodeSpan('ChangeMe!Teacher2026'),
                ],
              ),
              textAlign: TextAlign.center,
            ),
          const SizedBox(height: 8),
          // FR-REG-001 — the public path. The web client puts the application
          // on its landing page; the mobile equivalent is here, beside sign-in,
          // because this is where somebody with no account lands.
          const Divider(height: 24),
          Text(
            "Not a student yet?",
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, color: muted),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const ApplicationPage()),
              );
            },
            child: const Text('Apply for admission'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const TrackApplicationPage()),
              );
            },
            child: const Text('Track your application'),
          ),
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
        fontSize: 13.5,
        fontWeight: FontWeight.w600,
        color: dark ? AppColorsDark.ink2 : AppColors.ink2,
      ),
    );
  }
}

class _CodeSpan extends TextSpan {
  const _CodeSpan(String text)
      : super(
          text: text,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 11.5,
            backgroundColor: AppColors.surface2,
          ),
        );
}