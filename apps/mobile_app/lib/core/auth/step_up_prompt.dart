import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/token_store.dart';
import '../../../../core/theme/app_theme.dart';

/// Shows a password confirmation dialog for sensitive operations.
/// Call [showStepUpDialog] to present it.
class StepUpPrompt extends StatefulWidget {
  const StepUpPrompt({
    super.key,
    required this.what,
    required this.onDone,
    required this.onCancel,
  });

  final String what;
  final VoidCallback onDone;
  final VoidCallback onCancel;

  @override
  State<StepUpPrompt> createState() => _StepUpPromptState();

  /// Show the step-up dialog and return true if confirmed, false if cancelled.
  static Future<bool> show(
    BuildContext context, {
    required String what,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StepUpPrompt(
        what: what,
        onDone: () => Navigator.pop(ctx, true),
        onCancel: () => Navigator.pop(ctx, false),
      ),
    );
    return result ?? false;
  }
}

class _StepUpPromptState extends State<StepUpPrompt> {
  final _passwordController = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final password = _passwordController.text;
    if (password.isEmpty) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final result = await api.post<Map<String, dynamic>>(
        '/auth/step-up',
        {'password': password},
      );

      final accessToken = result['accessToken'] as String?;
      if (accessToken != null) {
        TokenStore.instance.accessToken = accessToken;
      }

      _passwordController.clear();
      widget.onDone();
    } catch (e) {
      final message = _parseError(e);
      setState(() => _error = message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _parseError(dynamic e) {
    final str = e.toString();
    if (str.contains('401') || str.toLowerCase().contains('invalid') ||
        str.toLowerCase().contains('wrong') || str.toLowerCase().contains('incorrect')) {
      return 'That password is not right.';
    }
    if (str.toLowerCase().contains('network') || str.toLowerCase().contains('connection')) {
      return 'Could not connect to the server.';
    }
    return 'Could not confirm it.';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;

    return Dialog(
      backgroundColor: dark ? AppColorsDark.surface : AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.lock_outline,
                    color: AppColors.warn,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Confirm your password',
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'To ${widget.what}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'You stay signed in either way. This is asked because the action '
                'is one somebody could do from an unattended screen.',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: dark ? AppColorsDark.muted : AppColors.muted,
                ),
              ),
              const SizedBox(height: 16),
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.warnBg,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(color: AppColors.warn, fontSize: 13),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              Text(
                'Your password',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              TextField(
                controller: _passwordController,
                obscureText: true,
                autofocus: true,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: dark ? AppColorsDark.ink : AppColors.ink,
                ),
                decoration: InputDecoration(
                  hintText: 'Enter your password',
                  hintStyle: TextStyle(
                    color: dark ? AppColorsDark.muted : AppColors.muted,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: BorderSide(
                      color: dark ? AppColorsDark.line : AppColors.line,
                    ),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: BorderSide(
                      color: dark ? AppColorsDark.line : AppColors.line,
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(6),
                    borderSide: BorderSide(
                      color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                    ),
                  ),
                  filled: true,
                  fillColor: dark ? AppColorsDark.surface2 : AppColors.surface2,
                ),
                onSubmitted: (_) {
                  if (_passwordController.text.isNotEmpty) _confirm();
                },
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _busy ? null : widget.onCancel,
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        color: dark ? AppColorsDark.muted : AppColors.muted,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    height: 36,
                    child: ElevatedButton(
                      onPressed: (_busy || _passwordController.text.isEmpty)
                          ? null
                          : _confirm,
                      style: ElevatedButton.styleFrom(
                        backgroundColor:
                            dark ? AppColorsDark.brand600 : AppColors.brand600,
                        foregroundColor:
                            dark ? AppColorsDark.navy : Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
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

/// True when the server refused for want of a recent re-authentication.
bool needsStepUp(dynamic error) {
  final str = error.toString();
  return str.contains('AUTH_STEP_UP_REQUIRED') ||
      str.contains('step_up_required') ||
      str.contains('STEP_UP');
}
