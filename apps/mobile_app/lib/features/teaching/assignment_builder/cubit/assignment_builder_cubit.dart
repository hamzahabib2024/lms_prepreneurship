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
    this.opensAt = '',
    this.dueAt = '',
    this.hardCloseAt = '',
    this.latePolicy = 'FLAG_ONLY',
    this.latePenaltyValue = '10',
    this.latePenaltyFloor = '40',
    this.submissionType = 'FILE',
    this.allowedFileTypes = const ['pdf'],
    this.maxFileSizeMb = '10',
    this.maxFileCount = '3',
    this.resubmissionPolicy = 'NONE',
    this.maxAttempts = '2',
    this.graceMinutes = '0',
    this.publicationStatus = 'DRAFT',
    this.rubricId,
    this.rubrics = const [],
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
  final String opensAt;
  final String dueAt;
  final String hardCloseAt;
  final String latePolicy;
  final String latePenaltyValue;
  final String latePenaltyFloor;
  final String submissionType;
  final List<String> allowedFileTypes;
  final String maxFileSizeMb;
  final String maxFileCount;
  final String resubmissionPolicy;
  final String maxAttempts;
  final String graceMinutes;
  final String publicationStatus;
  final String? rubricId;
  final List<RubricSummary> rubrics;
  final bool? saving;
  final String? error;
  final bool hasBriefAudio;
  final bool uploadingBrief;

  @override
  List<Object?> get props => [
    status, sectionSubjects, selectedSectionSubject,
    title, description, marksAvailable, opensAt, dueAt, hardCloseAt,
    latePolicy, latePenaltyValue, latePenaltyFloor,
    submissionType, allowedFileTypes, maxFileSizeMb, maxFileCount,
    resubmissionPolicy, maxAttempts, graceMinutes,
    publicationStatus, rubricId, rubrics, saving, error,
    hasBriefAudio, uploadingBrief,
  ];

  AssignmentBuilderState copyWith({
    AssignmentBuilderStatus? status,
    List<SectionSubject>? sectionSubjects,
    SectionSubject? selectedSectionSubject,
    String? title,
    String? description,
    int? marksAvailable,
    String? opensAt,
    String? dueAt,
    String? hardCloseAt,
    String? latePolicy,
    String? latePenaltyValue,
    String? latePenaltyFloor,
    String? submissionType,
    List<String>? allowedFileTypes,
    String? maxFileSizeMb,
    String? maxFileCount,
    String? resubmissionPolicy,
    String? maxAttempts,
    String? graceMinutes,
    String? publicationStatus,
    String? rubricId,
    List<RubricSummary>? rubrics,
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
      opensAt: opensAt ?? this.opensAt,
      dueAt: dueAt ?? this.dueAt,
      hardCloseAt: hardCloseAt ?? this.hardCloseAt,
      latePolicy: latePolicy ?? this.latePolicy,
      latePenaltyValue: latePenaltyValue ?? this.latePenaltyValue,
      latePenaltyFloor: latePenaltyFloor ?? this.latePenaltyFloor,
      submissionType: submissionType ?? this.submissionType,
      allowedFileTypes: allowedFileTypes ?? this.allowedFileTypes,
      maxFileSizeMb: maxFileSizeMb ?? this.maxFileSizeMb,
      maxFileCount: maxFileCount ?? this.maxFileCount,
      resubmissionPolicy: resubmissionPolicy ?? this.resubmissionPolicy,
      maxAttempts: maxAttempts ?? this.maxAttempts,
      graceMinutes: graceMinutes ?? this.graceMinutes,
      publicationStatus: publicationStatus ?? this.publicationStatus,
      rubricId: rubricId ?? this.rubricId,
      rubrics: rubrics ?? this.rubrics,
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
      final results = await Future.wait([
        _repo.getSectionSubjects(),
        _repo.getRubrics().catchError((_) => <RubricSummary>[]),
      ]);
      final sections = results[0] as List<SectionSubject>;
      final rubrics = results[1] as List<RubricSummary>;
      emit(state.copyWith(
        status: AssignmentBuilderStatus.loaded,
        sectionSubjects: sections,
        rubrics: rubrics,
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
  void updateOpensAt(String value) => emit(state.copyWith(opensAt: value));
  void updateDueAt(String value) => emit(state.copyWith(dueAt: value));
  void updateHardCloseAt(String value) => emit(state.copyWith(hardCloseAt: value));
  void updateLatePolicy(String value) => emit(state.copyWith(latePolicy: value));
  void updateLatePenaltyValue(String value) => emit(state.copyWith(latePenaltyValue: value));
  void updateLatePenaltyFloor(String value) => emit(state.copyWith(latePenaltyFloor: value));
  void updateSubmissionType(String value) => emit(state.copyWith(submissionType: value));
  void updateResubmissionPolicy(String value) => emit(state.copyWith(resubmissionPolicy: value));
  void updateMaxAttempts(String value) => emit(state.copyWith(maxAttempts: value));
  void updateGraceMinutes(String value) => emit(state.copyWith(graceMinutes: value));
  void updateMaxFileSizeMb(String value) => emit(state.copyWith(maxFileSizeMb: value));
  void updateMaxFileCount(String value) => emit(state.copyWith(maxFileCount: value));
  void updatePublicationStatus(String value) => emit(state.copyWith(publicationStatus: value));
  void updateRubricId(String? value) => emit(state.copyWith(rubricId: value));
  void updateSelectedSectionSubject(SectionSubject? value) =>
      emit(state.copyWith(selectedSectionSubject: value));

  void toggleFileType(String type) {
    final current = List<String>.from(state.allowedFileTypes);
    if (current.contains(type)) {
      current.remove(type);
    } else {
      current.add(type);
    }
    emit(state.copyWith(allowedFileTypes: current));
  }

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
        opensAt: state.opensAt.isNotEmpty ? state.opensAt : null,
        dueAt: state.dueAt,
        hardCloseAt: state.hardCloseAt.isNotEmpty ? state.hardCloseAt : null,
        latePolicy: state.latePolicy,
        latePenaltyValue: (state.latePolicy == 'FIXED_DEDUCTION' || state.latePolicy == 'PER_DAY_PERCENT')
            ? num.tryParse(state.latePenaltyValue)
            : null,
        latePenaltyFloor: (state.latePolicy == 'FIXED_DEDUCTION' || state.latePolicy == 'PER_DAY_PERCENT')
            ? num.tryParse(state.latePenaltyFloor)
            : null,
        submissionType: state.submissionType,
        allowedFileTypes: state.submissionType != 'TEXT' ? state.allowedFileTypes : [],
        maxFileSizeMb: int.tryParse(state.maxFileSizeMb) ?? 10,
        maxFileCount: int.tryParse(state.maxFileCount) ?? 3,
        resubmissionPolicy: state.resubmissionPolicy,
        maxAttempts: state.resubmissionPolicy == 'LIMITED' ? int.tryParse(state.maxAttempts) : null,
        graceMinutes: int.tryParse(state.graceMinutes) ?? 0,
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
