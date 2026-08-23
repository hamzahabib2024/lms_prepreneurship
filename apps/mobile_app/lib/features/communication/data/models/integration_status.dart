class IntegrationStatus {
  const IntegrationStatus({
    required this.key,
    required this.name,
    this.dependency,
    required this.mode,
    required this.behaviour,
    this.toGoLive,
  });

  final String key;
  final String name;
  final String? dependency;
  final String mode;
  final String behaviour;
  final String? toGoLive;

  bool get isLive => mode == 'LIVE';
  bool get isSimulated => mode == 'SIMULATED';
  bool get isNotConfigured => mode == 'NOT_CONFIGURED';

  factory IntegrationStatus.fromJson(Map<String, dynamic> json) {
    return IntegrationStatus(
      key: json['key'] as String,
      name: json['name'] as String,
      dependency: json['dependency'] as String?,
      mode: json['mode'] as String,
      behaviour: json['behaviour'] as String? ?? '',
      toGoLive: json['toGoLive'] as String?,
    );
  }
}
