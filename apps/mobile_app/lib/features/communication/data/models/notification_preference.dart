class NotificationPreference {
  const NotificationPreference({
    required this.channels,
    required this.mutedKinds,
    this.quietHoursStart,
    this.quietHoursEnd,
    this.availableChannels = const [],
  });

  final List<String> channels;
  final List<String> mutedKinds;
  final int? quietHoursStart;
  final int? quietHoursEnd;
  final List<Map<String, dynamic>> availableChannels;

  bool get isWhatsAppEnabled => channels.contains('WHATSAPP');
  bool get isEmailEnabled => channels.contains('EMAIL');
  bool get isSmsEnabled => channels.contains('SMS');
  bool get hasQuietHours => quietHoursStart != null && quietHoursEnd != null;

  factory NotificationPreference.fromJson(Map<String, dynamic> json) {
    return NotificationPreference(
      channels: (json['channels'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      mutedKinds: (json['mutedKinds'] as List<dynamic>? ?? const [])
          .whereType<String>()
          .toList(),
      quietHoursStart: json['quietHoursStart'] as int?,
      quietHoursEnd: json['quietHoursEnd'] as int?,
      availableChannels: (json['availableChannels'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(),
    );
  }

  NotificationPreference copyWith({
    List<String>? channels,
    List<String>? mutedKinds,
    int? quietHoursStart,
    int? quietHoursEnd,
    bool clearQuietHours = false,
  }) {
    return NotificationPreference(
      channels: channels ?? this.channels,
      mutedKinds: mutedKinds ?? this.mutedKinds,
      quietHoursStart: clearQuietHours ? null : (quietHoursStart ?? this.quietHoursStart),
      quietHoursEnd: clearQuietHours ? null : (quietHoursEnd ?? this.quietHoursEnd),
      availableChannels: availableChannels,
    );
  }
}
