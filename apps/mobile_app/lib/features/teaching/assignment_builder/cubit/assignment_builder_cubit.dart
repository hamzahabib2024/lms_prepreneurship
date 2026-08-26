import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/assignment_builder_repository.dart';
import '../data/models/assignment_builder_models.dart';

class AssignmentBuilderState extends Equatable {
  const AssignmentBuilderState({
    this.status = AssignmentBuilderStatus.initial,
    this.sectionSubjects = const [],
    this.selectedSectionSubject,
    this.title = '',
    this.description = '',
    this.marksAvailable = 100,
    this.dueAt = '',
    this.latePolicy = 'FLAG_ONLY',
    this.publicationStatus = 'DRAFT',
    this.rubricId,
    this.saving,
    this.error,
    this.hasBriefAudio = false,
    this.uploadingBrief = false,
  });

  final AssignmentBuilderStatus status;
  final List<SectionSubject> sectionSubjects;
  final SectionSubject? selectedSectionSubject;
  final String title;
  final String description;
  final int marksAvailable;
  final String dueAt;
  final String latePolicy;
  final String publicationStatus;
  final String? rubricId;
  final bool? saving;
  final String? error;
  final bool hasBriefAudio;
  final bool uploadingBrief;

  @override
  List<Object?> get props => [
    status, sectionSubjects, selectedSectionSubject,
    title, description, marksAvailable, dueAt,
    latePolicy, publicationStatus, rubricId, saving, error,
    hasBriefAudio, uploadingBrief,
  ];

  AssignmentBuilderState copyWith({
    AssignmentBuilderStatus? status,
    List<SectionSubject>? sectionSubjects,
    SectionSubject? selectedSectionSubject,
    String? title,
    String? description,
    int? marksAvailable,
    String? dueAt,
    String? latePolicy,
    String? publicationStatus,
    String? rubricId,
    bool? saving,
    String? error,
    bool? hasBriefAudio,
    bool? uploadingBrief,
  }) {
    return AssignmentBuilderState(
      status: status ?? this.status,
      sectionSubjects: sectionSubjects ?? this.sectionSubjects,
      selectedSectionSubject: selectedSectionSubject ?? this.selectedSectionSubject,
      title: title ?? this.title,
      description: description ?? this.description,
      marksAvailable: marksAvailable ?? this.marksAvailable,
      dueAt: dueAt ?? this.dueAt,
      latePolicy: latePolicy ?? this.latePolicy,
      publicationStatus: publicationStatus ?? this.publicationStatus,
      rubricId: rubricId ?? this.rubricId,
      saving: saving ?? this.saving,
      error: error ?? this.error,
      hasBriefAudio: hasBriefAudio ?? this.hasBriefAudio,
      uploadingBrief: uploadingBrief ?? this.uploadingBrief,
    );
  }
}

enum AssignmentBuilderStatus { initial, loading, loaded, saving, failure, saved }

class AssignmentBuilderCubit extends Cubit<AssignmentBuilderState> {
  AssignmentBuilderCubit(this._repo, {this.assignmentId})
      : super(const AssignmentBuilderState());
  final AssignmentBuilderRepository _repo;
  final String? assignmentId;

  Future<void> loadSectionSubjects() async {
    emit(state.copyWith(status: AssignmentBuilderStatus.loading));
    try {
      final sections = await _repo.getSectionSubjects();
      emit(state.copyWith(
        status: AssignmentBuilderStatus.loaded,
        sectionSubjects: sections,
      ));
    } catch (e) {
      emit(state.copyWith(
        status: AssignmentBuilderStatus.failure,
        error: 'Failed to load sections: $e',
      ));
    }
  }

  void updateTitle(String value) => emit(state.copyWith(title: value));
  void updateDescription(String value) => emit(state.copyWith(description: value));
  void updateMarksAvailable(int value) => emit(state.copyWith(marksAvailable: value));
  void updateDueAt(String value) => emit(state.copyWith(dueAt: value));
  void updateLatePolicy(String value) => emit(state.copyWith(latePolicy: value));
  void updatePublicationStatus(String value) => emit(state.copyWith(publicationStatus: value));
  void updateRubricId(String? value) => emit(state.copyWith(rubricId: value));
  void updateSelectedSectionSubject(SectionSubject? value) =>
      emit(state.copyWith(selectedSectionSubject: value));

  Future<void> save() async {
    if (state.title.isEmpty) {
      emit(state.copyWith(error: 'Title is required'));
      return;
    }
    if (state.selectedSectionSubject == null) {
      emit(state.copyWith(error: 'Select a section/subject'));
      return;
    }

    emit(state.copyWith(saving: true, error: null));
    try {
      final draft = AssignmentDraft(
        id: assignmentId,
        title: state.title,
        sectionSubjectId: state.selectedSectionSubject!.id,
        marksAvailable: state.marksAvailable,
        dueAt: state.dueAt,
        latePolicy: state.latePolicy,
        publicationStatus: state.publicationStatus,
        rubricId: state.rubricId,
        description: state.description.isNotEmpty ? state.description : null,
      );

      if (assignmentId != null) {
        await _repo.updateAssignment(draft);
      } else {
        await _repo.createAssignment(draft);
      }

      emit(state.copyWith(
        status: AssignmentBuilderStatus.saved,
        saving: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        saving: false,
        error: 'Failed to save assignment: $e',
      ));
    }
  }

  Future<void> publish() async {
    if (assignmentId == null) {
      emit(state.copyWith(error: 'Save the assignment first'));
      return;
    }
    emit(state.copyWith(saving: true));
    try {
      await _repo.publishAssignment(assignmentId!);
      emit(state.copyWith(
        status: AssignmentBuilderStatus.saved,
        publicationStatus: 'PUBLISHED',
        saving: false,
      ));
    } catch (e) {
      emit(state.copyWith(
        saving: false,
        error: 'Failed to publish: $e',
      ));
    }
  }

  // ── Voice Brief ──

  Future<void> uploadBriefAudio(File audioFile) async {
    if (assignmentId == null) {
      emit(state.copyWith(error: 'Save the assignment first'));
      return;
    }
    emit(state.copyWith(uploadingBrief: true, error: null));
    try {
      await _repo.uploadBriefAudio(
        assignmentId: assignmentId!,
        audioFile: audioFile,
      );
      emit(state.copyWith(uploadingBrief: false, hasBriefAudio: true));
    } catch (e) {
      emit(state.copyWith(
        uploadingBrief: false,
        error: 'Failed to upload audio: $e',
      ));
    }
  }

  Future<void> deleteBriefAudio() async {
    if (assignmentId == null) return;
    emit(state.copyWith(uploadingBrief: true, error: null));
    try {
      await _repo.deleteBriefAudio(assignmentId: assignmentId!);
      emit(state.copyWith(uploadingBrief: false, hasBriefAudio: false));
    } catch (e) {
      emit(state.copyWith(
        uploadingBrief: false,
        error: 'Failed to remove audio: $e',
      ));
    }
  }
}
