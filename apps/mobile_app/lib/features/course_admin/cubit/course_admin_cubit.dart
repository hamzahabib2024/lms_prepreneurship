import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/course_admin_repository.dart';
import '../data/models/course_admin_models.dart';

// ── State ──

class CourseAdminState extends Equatable {
  const CourseAdminState({
    this.programmes = const [],
    this.subjects = const [],
    this.loading = false,
    this.error,
  });

  final List<Programme> programmes;
  final List<Subject> subjects;
  final bool loading;
  final String? error;

  CourseAdminState copyWith({
    List<Programme>? programmes,
    List<Subject>? subjects,
    bool? loading,
    String? error,
    bool clearError = false,
  }) {
    return CourseAdminState(
      programmes: programmes ?? this.programmes,
      subjects: subjects ?? this.subjects,
      loading: loading ?? this.loading,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  List<Object?> get props => [programmes, subjects, loading, error];
}

// ── Cubit ──

class CourseAdminCubit extends Cubit<CourseAdminState> {
  CourseAdminCubit(this._repo) : super(const CourseAdminState());

  final CourseAdminRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(loading: true, clearError: true));
    try {
      final results = await Future.wait([
        _repo.getCourseTree(),
        _repo.getSubjects(),
      ]);
      emit(state.copyWith(
        programmes: results[0] as List<Programme>,
        subjects: results[1] as List<Subject>,
        loading: false,
      ));
    } catch (e) {
      emit(state.copyWith(loading: false, error: 'Failed to load: $e'));
    }
  }

  Future<Subject?> createSubject({
    required String name,
    required String code,
    String? description,
    int? credits,
  }) async {
    try {
      final subject = await _repo.createSubject(
        name: name,
        code: code,
        description: description,
        credits: credits,
      );
      emit(state.copyWith(subjects: [...state.subjects, subject]));
      return subject;
    } catch (e) {
      emit(state.copyWith(error: 'Failed to create subject: $e'));
      return null;
    }
  }

  Future<Programme?> createProgramme({
    required String name,
    required String code,
    String? description,
    int? durationWeeks,
  }) async {
    try {
      final programme = await _repo.createProgramme(
        name: name,
        code: code,
        description: description,
        durationWeeks: durationWeeks,
      );
      emit(state.copyWith(programmes: [...state.programmes, programme]));
      return programme;
    } catch (e) {
      emit(state.copyWith(error: 'Failed to create course: $e'));
      return null;
    }
  }

  Future<void> createBatch({
    required String programmeId,
    required String name,
    required int capacity,
    required String genderRestriction,
    required String shift,
    required String deliveryMode,
    required List<String> subjectIds,
    String? teacherId,
    String? whatsappChannelUrl,
    String? whatsappGroupUrl,
  }) async {
    try {
      await _repo.createBatch(
        programmeId: programmeId,
        name: name,
        capacity: capacity,
        genderRestriction: genderRestriction,
        shift: shift,
        deliveryMode: deliveryMode,
        subjectIds: subjectIds,
        teacherId: teacherId,
        whatsappChannelUrl: whatsappChannelUrl,
        whatsappGroupUrl: whatsappGroupUrl,
      );
      await load(); // refresh
    } catch (e) {
      emit(state.copyWith(error: 'Failed to create batch: $e'));
    }
  }
}
