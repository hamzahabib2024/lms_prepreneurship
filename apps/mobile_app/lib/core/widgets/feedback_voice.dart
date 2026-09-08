import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/voice_recorder.dart';

/// Voice feedback widget for grading submissions.
/// Wraps VoiceRecorderWidget with grading-specific context.
class FeedbackVoiceWidget extends StatelessWidget {
  const FeedbackVoiceWidget({
    super.key,
    required this.onRecorded,
    this.existingAudioUrl,
  });

  final ValueChanged<List<int>> onRecorded;
  final String? existingAudioUrl;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (existingAudioUrl != null) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(AppRadius.sm),
            ),
            child: Row(
              children: [
                const Icon(Icons.audiotrack_outlined, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Existing voice feedback',
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () {
                    // Play existing audio
                  },
                  icon: const Icon(Icons.play_circle_outline, size: 24),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
        VoiceRecorderWidget(
          onRecorded: onRecorded,
          label: 'Record voice feedback',
        ),
      ],
    );
  }
}
