import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../teaching/data/teaching_repository.dart';

enum RecordingStatus { idle, recording, stopped }

class VoiceRecorderCubit extends Cubit<VoiceRecorderState> {
  VoiceRecorderCubit() : super(const VoiceRecorderState());

  Future<void> startRecording() async {
    emit(state.copyWith(status: RecordingStatus.recording));
  }

  Future<void> stopRecording() async {
    emit(state.copyWith(status: RecordingStatus.stopped));
  }

  Future<void> reset() async {
    emit(state.copyWith(status: RecordingStatus.idle));
  }
}

class VoiceRecorderState {
  const VoiceRecorderState({
    this.status = RecordingStatus.idle,
    this.duration = Duration.zero,
  });

  final RecordingStatus status;
  final Duration duration;

  VoiceRecorderState copyWith({
    RecordingStatus? status,
    Duration? duration,
  }) {
    return VoiceRecorderState(
      status: status ?? this.status,
      duration: duration ?? this.duration,
    );
  }
}

class VoiceRecorderWidget extends StatefulWidget {
  const VoiceRecorderWidget({
    super.key,
    required this.onRecorded,
    this.label = 'Record voice briefing',
  });

  final ValueChanged<List<int>> onRecorded;
  final String label;

  @override
  State<VoiceRecorderWidget> createState() => _VoiceRecorderWidgetState();
}

class _VoiceRecorderWidgetState extends State<VoiceRecorderWidget> {
  RecordingStatus _status = RecordingStatus.idle;
  Duration _duration = Duration.zero;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startRecording() {
    setState(() {
      _status = RecordingStatus.recording;
      _duration = Duration.zero;
    });
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() => _duration += const Duration(seconds: 1));
    });
  }

  void _stopRecording() {
    _timer?.cancel();
    setState(() => _status = RecordingStatus.stopped);
  }

  void _reset() {
    _timer?.cancel();
    setState(() {
      _status = RecordingStatus.idle;
      _duration = Duration.zero;
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? AppColorsDark.muted : AppColors.muted;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.mic_outlined,
                size: 18,
                color: _status == RecordingStatus.recording
                    ? AppColors.error
                    : muted,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _status == RecordingStatus.recording
                      ? 'Recording... ${_formatDuration(_duration)}'
                      : _status == RecordingStatus.stopped
                          ? 'Recording ready (${_formatDuration(_duration)})'
                          : widget.label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: _status == RecordingStatus.recording
                        ? AppColors.error
                        : null,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              if (_status == RecordingStatus.idle)
                FilledButton.icon(
                  onPressed: _startRecording,
                  icon: const Icon(Icons.mic, size: 16),
                  label: const Text('Start recording'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.error,
                  ),
                )
              else if (_status == RecordingStatus.recording)
                FilledButton.icon(
                  onPressed: _stopRecording,
                  icon: const Icon(Icons.stop, size: 16),
                  label: const Text('Stop'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.error,
                  ),
                )
              else ...[
                FilledButton.icon(
                  onPressed: () {
                    // In a real implementation, this would record audio
                    // For now, simulate with empty bytes
                    widget.onRecorded([]);
                    _reset();
                  },
                  icon: const Icon(Icons.check, size: 16),
                  label: const Text('Use this'),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: _reset,
                  child: const Text('Re-record'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.toString().padLeft(2, '0');
    final seconds = (d.inSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }
}
