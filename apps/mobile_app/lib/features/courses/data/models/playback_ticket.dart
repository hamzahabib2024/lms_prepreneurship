/// A short-lived, user-bound ticket for streaming a lecture recording.
///
/// Maps `POST /recorded-lectures/:id/playback-ticket`. The ticket itself is
/// the credential on the public stream endpoint (ARC-039).
class PlaybackTicket {
  const PlaybackTicket({
    required this.ticketId,
    required this.streamUrl,
    this.expiresAt = '',
    this.durationSeconds,
    this.resumePositionSeconds = 0,
    this.watchedPercent = 0,
    this.recordsProgress = true,
  });

  final String ticketId;
  final String streamUrl;
  final String expiresAt;
  final int? durationSeconds;
  final int resumePositionSeconds;
  final double watchedPercent;
  final bool recordsProgress;

  factory PlaybackTicket.fromJson(Map<String, dynamic> json) =>
      PlaybackTicket(
        ticketId: json['ticketId'] as String? ?? '',
        streamUrl: json['streamUrl'] as String? ?? '',
        expiresAt: json['expiresAt'] as String? ?? '',
        durationSeconds: json['durationSeconds'] as int?,
        resumePositionSeconds:
            json['resumePositionSeconds'] as int? ?? 0,
        watchedPercent:
            (json['watchedPercent'] as num?)?.toDouble() ?? 0,
        recordsProgress: json['recordsProgress'] as bool? ?? true,
      );
}
