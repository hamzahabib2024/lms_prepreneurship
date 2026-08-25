/// Class page — SRS §5.11, UC-15.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/theme/app_theme.dart';
import '../cubit/class_page_cubit.dart';
import '../data/class_page_repository.dart';
import '../data/models/class_page_models.dart';

class ClassPage extends StatefulWidget {
  const ClassPage({super.key, required this.sessionId});
  final String sessionId;

  @override
  State<ClassPage> createState() => _ClassPageState();
}

class _ClassPageState extends State<ClassPage> {
  late final ClassPageCubit _cubit;

  @override
  void initState() {
    super.initState();
    _cubit = ClassPageCubit(context.read<ClassPageRepository>())
      ..loadJoinRoute(widget.sessionId);
  }

  @override
  void dispose() {
    _cubit.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Class'),
        ),
        body: BlocConsumer<ClassPageCubit, ClassPageState>(
          listener: (context, state) {
            if (state.error != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(state.error!)),
              );
            }
          },
          builder: (context, state) {
            if (state.status == ClassPageStatus.loading) {
              return const Center(child: CircularProgressIndicator());
            }

            if (state.status == ClassPageStatus.failure) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.error_outline, size: 64, color: AppColors.error),
                    const SizedBox(height: 16),
                    Text(
                      state.error ?? 'Failed to load class',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: dark ? AppColorsDark.ink : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => _cubit.loadJoinRoute(widget.sessionId),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              );
            }

            final joinRoute = state.joinRoute;
            if (joinRoute == null) {
              return const Center(child: Text('No session data'));
            }

            return _ClassBody(
              joinRoute: joinRoute,
              checkedIn: state.checkedIn,
              countdown: state.countdown,
              dark: dark,
              onJoin: () => _joinClass(joinRoute),
              onCheckIn: () => _cubit.checkIn(widget.sessionId),
            );
          },
        ),
      ),
    );
  }

  Future<void> _joinClass(JoinRoute joinRoute) async {
    if (joinRoute.isExternalRedirect && joinRoute.url != null) {
      if (!mounted) return;
      showDialog(
        context: context,
        builder: (_) => _JoinDialog(
          url: joinRoute.url!,
          onJoined: () {
            _cubit.checkIn(widget.sessionId);
          },
        ),
      );
    }
  }
}

// ── Class Body ──

class _ClassBody extends StatelessWidget {
  const _ClassBody({
    required this.joinRoute,
    required this.checkedIn,
    required this.countdown,
    required this.dark,
    required this.onJoin,
    required this.onCheckIn,
  });

  final JoinRoute joinRoute;
  final bool checkedIn;
  final Duration? countdown;
  final bool dark;
  final VoidCallback onJoin;
  final VoidCallback onCheckIn;

  @override
  Widget build(BuildContext context) {
    final session = joinRoute.session;
    final now = DateTime.now();
    final start = DateTime.tryParse(session.scheduledStart);
    final end = DateTime.tryParse(session.scheduledEnd);
    final isLive = start != null && end != null &&
        now.isAfter(start) && now.isBefore(end);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Breadcrumb
          Text(
            session.subject,
            style: TextStyle(
              color: dark ? AppColorsDark.muted : AppColors.muted,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),

          // Title
          Row(
            children: [
              Expanded(
                child: Text(
                  session.title,
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontWeight: FontWeight.bold,
                    fontSize: 22,
                  ),
                ),
              ),
              if (isLive)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.circle, size: 8, color: Colors.white),
                      SizedBox(width: 4),
                      Text(
                        'LIVE',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),

          // Date/time
          if (start != null)
            Row(
              children: [
                Icon(Icons.calendar_today, size: 16, color: AppColors.brand600),
                const SizedBox(width: 6),
                Text(
                  _formatDateTime(start),
                  style: TextStyle(
                    color: dark ? AppColorsDark.ink : AppColors.ink,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          if (start != null && end != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Icon(Icons.access_time, size: 16, color: AppColors.brand600),
                  const SizedBox(width: 6),
                  Text(
                    '${_formatTime(start)} – ${_formatTime(end)}',
                    style: TextStyle(
                      color: dark ? AppColorsDark.ink : AppColors.ink,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 24),

          // Stage area
          _StageArea(
            joinRoute: joinRoute,
            checkedIn: checkedIn,
            countdown: countdown,
            dark: dark,
            onJoin: onJoin,
            onCheckIn: onCheckIn,
          ),
          const SizedBox(height: 24),

          // Help notes
          _HelpNotes(dark: dark),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    return '${_dayName(dt.weekday)}, ${dt.day} ${_monthName(dt.month)} ${dt.year}';
  }

  String _formatTime(DateTime dt) {
    return '${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
  }

  String _dayName(int day) {
    const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return names[day];
  }

  String _monthName(int month) {
    const names = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return names[month];
  }
}

// ── Stage Area ──

class _StageArea extends StatelessWidget {
  const _StageArea({
    required this.joinRoute,
    required this.checkedIn,
    required this.countdown,
    required this.dark,
    required this.onJoin,
    required this.onCheckIn,
  });

  final JoinRoute joinRoute;
  final bool checkedIn;
  final Duration? countdown;
  final bool dark;
  final VoidCallback onJoin;
  final VoidCallback onCheckIn;

  @override
  Widget build(BuildContext context) {
    if (joinRoute.isExternalRedirect) {
      return _ExternalRedirectStage(
        url: joinRoute.url ?? '',
        checkedIn: checkedIn,
        dark: dark,
        onJoin: onJoin,
        onCheckIn: onCheckIn,
      );
    }

    if (joinRoute.isEmbeddedRoute) {
      return _EmbeddedRouteStage(
        internalPath: joinRoute.internalPath ?? '',
        token: joinRoute.token ?? '',
        dark: dark,
      );
    }

    // Unavailable
    return _UnavailableStage(
      message: joinRoute.message ?? 'This class is not available yet.',
      reasonCode: joinRoute.reasonCode ?? '',
      countdown: countdown,
      dark: dark,
    );
  }
}

// ── External Redirect Stage ──

class _ExternalRedirectStage extends StatelessWidget {
  const _ExternalRedirectStage({
    required this.url,
    required this.checkedIn,
    required this.dark,
    required this.onJoin,
    required this.onCheckIn,
  });

  final String url;
  final bool checkedIn;
  final bool dark;
  final VoidCallback onJoin;
  final VoidCallback onCheckIn;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      child: Column(
        children: [
          Icon(
            checkedIn ? Icons.check_circle : Icons.videocam,
            size: 64,
            color: checkedIn ? AppColors.ok : AppColors.brand600,
          ),
          const SizedBox(height: 16),
          if (checkedIn) ...[
            Text(
              'You are in the class',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your attendance has been recorded',
              style: TextStyle(
                color: AppColors.ok,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onJoin,
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open the class again'),
            ),
          ] else ...[
            Text(
              'Join the class',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'You will be redirected to the video meeting',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onJoin,
              icon: const Icon(Icons.launch),
              label: const Text('Join now'),
            ),
          ],
        ],
      ),
    );
  }
}

// ── Embedded Route Stage ──

class _EmbeddedRouteStage extends StatelessWidget {
  const _EmbeddedRouteStage({
    required this.internalPath,
    required this.token,
    required this.dark,
  });

  final String internalPath;
  final String token;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 300,
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.videocam,
              size: 48,
              color: AppColors.brand600,
            ),
            const SizedBox(height: 12),
            Text(
              'Embedded class',
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Loading video player...',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Unavailable Stage ──

class _UnavailableStage extends StatelessWidget {
  const _UnavailableStage({
    required this.message,
    required this.reasonCode,
    required this.countdown,
    required this.dark,
  });

  final String message;
  final String reasonCode;
  final Duration? countdown;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.surface : Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(
          color: dark ? AppColorsDark.line : AppColors.line,
        ),
      ),
      child: Column(
        children: [
          Icon(
            Icons.access_time,
            size: 64,
            color: dark ? AppColorsDark.muted : AppColors.muted,
          ),
          const SizedBox(height: 16),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: dark ? AppColorsDark.ink : AppColors.ink,
              fontWeight: FontWeight.w600,
              fontSize: 16,
            ),
          ),
          if (countdown != null && !countdown!.isNegative) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: dark ? AppColorsDark.brand050 : AppColors.brand050,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                _formatCountdown(countdown!),
                style: TextStyle(
                  color: dark ? AppColorsDark.brand600 : AppColors.brand600,
                  fontWeight: FontWeight.bold,
                  fontSize: 24,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'until the join window opens',
              style: TextStyle(
                color: dark ? AppColorsDark.muted : AppColors.muted,
                fontSize: 12,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatCountdown(Duration d) {
    final hours = d.inHours;
    final minutes = d.inMinutes.remainder(60);
    final seconds = d.inSeconds.remainder(60);
    if (hours > 0) {
      return '${hours}h ${minutes.toString().padLeft(2, '0')}m ${seconds.toString().padLeft(2, '0')}s';
    }
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }
}

// ── Help Notes ──

class _HelpNotes extends StatelessWidget {
  const _HelpNotes({required this.dark});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? AppColorsDark.brand050 : AppColors.brand050,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Help',
            style: TextStyle(
              color: dark ? AppColorsDark.brand600 : AppColors.brand600,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          _HelpItem(
            dark: dark,
            icon: Icons.info_outline,
            text: 'Your attendance will be recorded when you join the class',
          ),
          _HelpItem(
            dark: dark,
            icon: Icons.block,
            text: 'If a pop-up blocker appears, allow it to open the meeting',
          ),
          _HelpItem(
            dark: dark,
            icon: Icons.videocam,
            text: 'Recordings may be available after the session ends',
          ),
        ],
      ),
    );
  }
}

// ── Help Item ──

class _HelpItem extends StatelessWidget {
  const _HelpItem({
    required this.dark,
    required this.icon,
    required this.text,
  });

  final bool dark;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 16,
            color: dark ? AppColorsDark.brand600 : AppColors.brand600,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Join Dialog ──

class _JoinDialog extends StatelessWidget {
  const _JoinDialog({required this.url, required this.onJoined});
  final String url;
  final VoidCallback onJoined;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return AlertDialog(
      backgroundColor: dark ? AppColorsDark.surface : Colors.white,
      title: Text(
        'Join Class',
        style: TextStyle(color: dark ? AppColorsDark.ink : AppColors.ink),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Copy this link and open it in your browser to join the video meeting:',
            style: TextStyle(color: dark ? AppColorsDark.muted : AppColors.muted),
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: dark ? AppColorsDark.surface2 : AppColors.surface2,
              borderRadius: BorderRadius.circular(8),
            ),
            child: SelectableText(
              url,
              style: TextStyle(
                color: dark ? AppColorsDark.ink : AppColors.ink,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () {
            Clipboard.setData(ClipboardData(text: url));
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Link copied to clipboard')),
            );
          },
          child: const Text('Copy Link'),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(context).pop();
            onJoined();
          },
          child: const Text('I have joined'),
        ),
      ],
    );
  }
}
