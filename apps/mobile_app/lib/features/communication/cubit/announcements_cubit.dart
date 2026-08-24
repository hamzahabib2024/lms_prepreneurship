import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class AnnouncementsState extends Equatable {
  const AnnouncementsState({
    this.status = AnnouncementsStatus.loading,
    this.items = const [],
    this.error,
    this.posting = false,
    this.postResult,
  });

  final AnnouncementsStatus status;
  final List<Announcement> items;
  final ApiException? error;
  final bool posting;
  final String? postResult;

  AnnouncementsState copyWith({
    AnnouncementsStatus? status,
    List<Announcement>? items,
    ApiException? error,
    bool? posting,
    String? postResult,
    bool clearError = false,
    bool clearPostResult = false,
  }) =>
      AnnouncementsState(
        status: status ?? this.status,
        items: items ?? this.items,
        error: clearError ? null : (error ?? this.error),
        posting: posting ?? this.posting,
        postResult: clearPostResult ? null : (postResult ?? this.postResult),
      );

  @override
  List<Object?> get props => [status, items, error, posting, postResult];
}

enum AnnouncementsStatus { loading, loaded, failure }

class AnnouncementsCubit extends Cubit<AnnouncementsState> {
  AnnouncementsCubit({required this.repository})
      : super(const AnnouncementsState());

  final CommunicationRepository repository;

  Future<void> load() async {
    emit(state.copyWith(status: AnnouncementsStatus.loading, clearError: true));
    try {
      final items = await repository.listAnnouncements();
      emit(state.copyWith(
        status: AnnouncementsStatus.loaded,
        items: items,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: AnnouncementsStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> post({
    required String audience,
    String? sectionSubjectId,
    required String title,
    required String body,
    String priority = 'NORMAL',
    bool isPinned = false,
  }) async {
    emit(state.copyWith(posting: true, clearError: true, clearPostResult: true));
    try {
      final notified = await repository.createAnnouncement(
        audience: audience,
        sectionSubjectId: sectionSubjectId,
        title: title,
        body: body,
        priority: priority,
        isPinned: isPinned,
      );
      final msg = notified == 0
          ? 'Posted, but nobody is currently in that audience.'
          : 'Posted. $notified ${notified == 1 ? 'person was' : 'people were'} notified.';
      emit(state.copyWith(posting: false, postResult: msg));
      await load();
    } on ApiException catch (e) {
      emit(state.copyWith(posting: false, error: e));
    }
  }

  Future<void> withdraw(String id) async {
    try {
      await repository.withdrawAnnouncement(id);
      await load();
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }
}
