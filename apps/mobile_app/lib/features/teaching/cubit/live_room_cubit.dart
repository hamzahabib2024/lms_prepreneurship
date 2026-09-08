import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class LiveRoomInfo {
  const LiveRoomInfo({
    required this.url,
    required this.token,
    required this.roomName,
    this.participantCount = 0,
  });

  final String url;
  final String token;
  final String roomName;
  final int participantCount;

  factory LiveRoomInfo.fromJson(Map<String, dynamic> json) {
    return LiveRoomInfo(
      url: json['url'] as String? ?? '',
      token: json['token'] as String? ?? '',
      roomName: json['roomName'] as String? ?? '',
      participantCount: (json['participantCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class LiveRoomCubit extends Cubit<LiveRoomState> {
  LiveRoomCubit({required this.api}) : super(const LiveRoomState());

  final ApiClient api;

  Future<void> joinRoom({required String classId}) async {
    emit(state.copyWith(joining: true, error: null));
    try {
      final json = await api.post<Map<String, dynamic>>(
        '/live-rooms/$classId/join',
        {},
      );
      if (isClosed) return;
      emit(state.copyWith(
        joining: false,
        roomInfo: LiveRoomInfo.fromJson(json),
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(joining: false, error: error));
    }
  }

  void setCameraEnabled(bool enabled) {
    emit(state.copyWith(cameraEnabled: enabled));
  }

  void setMicrophoneEnabled(bool enabled) {
    emit(state.copyWith(microphoneEnabled: enabled));
  }

  void markJoined() {
    emit(state.copyWith(hasJoined: true));
  }

  void markLeft() {
    emit(state.copyWith(hasLeft: true));
  }
}

class LiveRoomState extends Equatable {
  const LiveRoomState({
    this.joining = false,
    this.roomInfo,
    this.error,
    this.cameraEnabled = true,
    this.microphoneEnabled = true,
    this.hasJoined = false,
    this.hasLeft = false,
  });

  final bool joining;
  final LiveRoomInfo? roomInfo;
  final ApiException? error;
  final bool cameraEnabled;
  final bool microphoneEnabled;
  final bool hasJoined;
  final bool hasLeft;

  LiveRoomState copyWith({
    bool? joining,
    LiveRoomInfo? roomInfo,
    ApiException? error,
    bool? cameraEnabled,
    bool? microphoneEnabled,
    bool? hasJoined,
    bool? hasLeft,
  }) {
    return LiveRoomState(
      joining: joining ?? this.joining,
      roomInfo: roomInfo ?? this.roomInfo,
      error: error,
      cameraEnabled: cameraEnabled ?? this.cameraEnabled,
      microphoneEnabled: microphoneEnabled ?? this.microphoneEnabled,
      hasJoined: hasJoined ?? this.hasJoined,
      hasLeft: hasLeft ?? this.hasLeft,
    );
  }

  @override
  List<Object?> get props => [
        joining,
        roomInfo,
        error,
        cameraEnabled,
        microphoneEnabled,
        hasJoined,
        hasLeft,
      ];
}
