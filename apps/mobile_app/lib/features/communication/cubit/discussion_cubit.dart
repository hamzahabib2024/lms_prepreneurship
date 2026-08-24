import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/communication_repository.dart';
import '../data/models/models.dart';

class DiscussionState extends Equatable {
  const DiscussionState({
    this.status = DiscussionStatus.loading,
    this.offerings = const [],
    this.selectedOfferingId,
    this.threads = const [],
    this.openThread,
    this.error,
    this.posting = false,
    this.replyBusy = false,
  });

  final DiscussionStatus status;
  final List<Offering> offerings;
  final String? selectedOfferingId;
  final List<DiscussionPost> threads;
  final DiscussionThread? openThread;
  final ApiException? error;
  final bool posting;
  final bool replyBusy;

  DiscussionState copyWith({
    DiscussionStatus? status,
    List<Offering>? offerings,
    String? selectedOfferingId,
    List<DiscussionPost>? threads,
    DiscussionThread? openThread,
    ApiException? error,
    bool? posting,
    bool? replyBusy,
    bool clearError = false,
    bool clearThread = false,
  }) =>
      DiscussionState(
        status: status ?? this.status,
        offerings: offerings ?? this.offerings,
        selectedOfferingId: selectedOfferingId ?? this.selectedOfferingId,
        threads: threads ?? this.threads,
        openThread: clearThread ? null : (openThread ?? this.openThread),
        error: clearError ? null : (error ?? this.error),
        posting: posting ?? this.posting,
        replyBusy: replyBusy ?? this.replyBusy,
      );

  @override
  List<Object?> get props => [
        status,
        offerings,
        selectedOfferingId,
        threads,
        openThread,
        error,
        posting,
        replyBusy,
      ];
}

enum DiscussionStatus { loading, loaded, failure }

class DiscussionCubit extends Cubit<DiscussionState> {
  DiscussionCubit({required this.repository})
      : super(const DiscussionState());

  final CommunicationRepository repository;

  Future<void> loadOfferings() async {
    try {
      final offerings = await repository.listOfferings();
      final selected = offerings.isNotEmpty ? offerings.first.id : null;
      emit(state.copyWith(
        offerings: offerings,
        selectedOfferingId: selected,
      ));
      if (selected != null) await loadThreads(selected);
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: DiscussionStatus.failure,
        error: e,
      ));
    }
  }

  void selectOffering(String id) {
    emit(state.copyWith(
      selectedOfferingId: id,
      threads: const [],
      status: DiscussionStatus.loading,
      clearThread: true,
    ));
    loadThreads(id);
  }

  Future<void> loadThreads(String sectionSubjectId) async {
    emit(state.copyWith(status: DiscussionStatus.loading, clearError: true));
    try {
      final threads = await repository.listDiscussions(sectionSubjectId);
      emit(state.copyWith(
        status: DiscussionStatus.loaded,
        threads: threads,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: DiscussionStatus.failure,
        error: e,
      ));
    }
  }

  Future<void> openThread(String postId) async {
    emit(state.copyWith(clearError: true));
    try {
      final thread = await repository.getThread(postId);
      emit(state.copyWith(openThread: thread));
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }

  void closeThread() {
    emit(state.copyWith(clearThread: true));
    if (state.selectedOfferingId != null) {
      loadThreads(state.selectedOfferingId!);
    }
  }

  Future<void> createDiscussion({
    required String title,
    required String body,
  }) async {
    final offeringId = state.selectedOfferingId;
    if (offeringId == null) return;

    emit(state.copyWith(posting: true, clearError: true));
    try {
      await repository.createDiscussion(
        sectionSubjectId: offeringId,
        title: title,
        body: body,
      );
      emit(state.copyWith(posting: false));
      await loadThreads(offeringId);
    } on ApiException catch (e) {
      emit(state.copyWith(posting: false, error: e));
    }
  }

  Future<void> reply({required String postId, required String body}) async {
    emit(state.copyWith(replyBusy: true, clearError: true));
    try {
      await repository.replyToDiscussion(postId: postId, body: body);
      final thread = await repository.getThread(postId);
      emit(state.copyWith(replyBusy: false, openThread: thread));
    } on ApiException catch (e) {
      emit(state.copyWith(replyBusy: false, error: e));
    }
  }

  Future<void> editPost({
    required String postId,
    required String body,
  }) async {
    try {
      await repository.editPost(postId: postId, body: body);
      // Refresh the thread view.
      if (state.openThread != null) {
        final thread = await repository.getThread(state.openThread!.id);
        emit(state.copyWith(openThread: thread));
      }
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }

  Future<void> removePost({required String postId, String? reason}) async {
    try {
      await repository.removePost(postId: postId, reason: reason);
      if (state.openThread != null) {
        final thread = await repository.getThread(state.openThread!.id);
        emit(state.copyWith(openThread: thread));
      } else if (state.selectedOfferingId != null) {
        await loadThreads(state.selectedOfferingId!);
      }
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }

  Future<void> moderate({
    required String postId,
    bool? isPinned,
    bool? isLocked,
  }) async {
    try {
      await repository.moderatePost(
        postId: postId,
        isPinned: isPinned,
        isLocked: isLocked,
      );
      if (state.openThread != null) {
        final thread = await repository.getThread(state.openThread!.id);
        emit(state.copyWith(openThread: thread));
      }
    } on ApiException catch (e) {
      emit(state.copyWith(error: e));
    }
  }
}
