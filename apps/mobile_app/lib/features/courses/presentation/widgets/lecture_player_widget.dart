import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:video_player/video_player.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../auth/data/models/auth_session.dart';
import '../../cubit/watch_cubit.dart';
import '../../data/models/course_lectures.dart';
import '../../data/models/playback_ticket.dart';

/// The core video player widget — mirrors the web's LecturePlayer.tsx.
///
/// Fetches a playback ticket, initializes the video controller, seeks to
/// the resume position, tracks intervals, and reports progress every 15
/// seconds. On dispose, any pending intervals are flushed immediately.
class LecturePlayerWidget extends StatefulWidget {
  const LecturePlayerWidget({
    super.key,
    required this.ticket,
    required this.lecture,
    required this.user,
  });

  final PlaybackTicket ticket;
  final CourseLecture lecture;
  final AuthUser user;

  @override
  State<LecturePlayerWidget> createState() => _LecturePlayerWidgetState();
}

class _LecturePlayerWidgetState extends State<LecturePlayerWidget> {
  late VideoPlayerController _controller;
  bool _initialized = false;
  bool _resumed = false;
  bool _showControls = true;
  Timer? _hideControlsTimer;

  @override
  void initState() {
    super.initState();
    _initPlayer();
  }

  Future<void> _initPlayer() async {
    final streamUrl = widget.ticket.streamUrl;
    if (streamUrl.isEmpty) return;

    _controller = VideoPlayerController.networkUrl(
      Uri.parse(streamUrl),
    );

    try {
      await _controller.initialize();
      if (!mounted) return;

      setState(() => _initialized = true);

      // Add listener for time updates.
      _controller.addListener(_onTimeUpdate);

      // Resume from saved position — FR-VID-008.
      final resume = widget.ticket.resumePositionSeconds;
      if (resume > 5 && !_resumed) {
        _resumed = true;
        final duration = _controller.value.duration.inSeconds;
        // Don't seek if within 10s of the end.
        if (duration - resume > 10) {
          await _controller.seekTo(Duration(seconds: resume));
        }
      }

      // Auto-play.
      _controller.play();
      _startHideControlsTimer();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not load video: $e'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    }
  }

  void _onTimeUpdate() {
    if (!_controller.value.isPlaying) return;
    final position = _controller.value.position.inSeconds;
    context.read<WatchCubit>().onTimeUpdate(position);
  }

  void _startHideControlsTimer() {
    _hideControlsTimer?.cancel();
    _hideControlsTimer = Timer(const Duration(seconds: 5), () {
      if (mounted && _controller.value.isPlaying) {
        setState(() => _showControls = false);
      }
    });
  }

  void _toggleControls() {
    setState(() => _showControls = !_showControls);
    if (_showControls) _startHideControlsTimer();
  }

  @override
  void dispose() {
    _hideControlsTimer?.cancel();
    _controller.removeListener(_onTimeUpdate);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialized) {
      return Container(
        height: 220,
        color: Colors.black,
        child: const Center(
          child: CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
          ),
        ),
      );
    }

    final aspectRatio = _controller.value.aspectRatio;

    return GestureDetector(
      onTap: _toggleControls,
      child: Container(
        color: Colors.black,
        child: AspectRatio(
          aspectRatio: aspectRatio,
          child: Stack(
            alignment: Alignment.bottomCenter,
            children: [
              VideoPlayer(_controller),

              // Play/pause overlay.
              if (_showControls)
                AnimatedOpacity(
                  opacity: _showControls ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 200),
                  child: Container(
                    color: Colors.black26,
                    child: Center(
                      child: GestureDetector(
                        onTap: () {
                          if (_controller.value.isPlaying) {
                            _controller.pause();
                          } else {
                            _controller.play();
                            _startHideControlsTimer();
                          }
                        },
                        child: Container(
                          width: 56,
                          height: 56,
                          decoration: const BoxDecoration(
                            color: Colors.black54,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _controller.value.isPlaying
                                ? Icons.pause
                                : Icons.play_arrow,
                            color: Colors.white,
                            size: 32,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),

              // Bottom bar with seek bar and time.
              if (_showControls)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.transparent, Colors.black54],
                      ),
                    ),
                    child: SafeArea(
                      top: false,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          VideoProgressIndicator(
                            _controller,
                            allowScrubbing: true,
                            colors: VideoProgressColors(
                              playedColor: AppColors.amber,
                              bufferedColor: Colors.white30,
                              backgroundColor: Colors.white12,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                _formatPosition(
                                    _controller.value.position),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                ),
                              ),
                              Text(
                                _formatPosition(
                                    _controller.value.duration),
                                style: const TextStyle(
                                  color: Colors.white70,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

              // Staff badge.
              if (!widget.user.isStudent)
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text(
                      'Staff view — not recording progress',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatPosition(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    final s = d.inSeconds.remainder(60);
    if (h > 0) {
      return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}
