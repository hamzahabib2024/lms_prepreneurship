import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/courses_repository.dart';
import '../data/models/course_lectures.dart';
import '../data/models/lesson_resource.dart';

/// State for the course detail page (lectures list + resources).
class CourseDetailState extends Equatable {
  const CourseDetailState({
    this.status = CourseDetailStatus.loading,
    this.data,
    this.resources = const {},
    this.error,
  });

  final CourseDetailStatus status;
  final CourseLectures? data;
  final Map<String, List<LessonResource>> resources;
  final ApiException? error;

  List<CourseLecture> get playable =>
      data?.lectures.where((l) => l.isAvailable).toList() ?? [];

  CourseDetailState copyWith({
    CourseDetailStatus? status,
    CourseLectures? data,
    Map<String, List<LessonResource>>? resources,
    ApiException? error,
    bool clearError = false,
  }) =>
      CourseDetailState(
        status: status ?? this.status,
        data: data ?? this.data,
        resources: resources ?? this.resources,
        error: clearError ? null : (error ?? this.error),
      );

  @override
  List<Object?> get props => [status, data, resources, error];
}

enum CourseDetailStatus { loading, loaded, failure }

/// Cubit for the course detail page.
class CourseDetailCubit extends Cubit<CourseDetailState> {
  CourseDetailCubit({
    required this.repository,
    required this.sectionSubjectId,
  }) : super(const CourseDetailState());

  final CoursesRepository repository;
  final String sectionSubjectId;

  Future<void> load() async {
    emit(state.copyWith(
      status: CourseDetailStatus.loading,
      clearError: true,
    ));
    try {
      final data = await repository.lecturesFor(sectionSubjectId);
      emit(state.copyWith(
        status: CourseDetailStatus.loaded,
        data: data,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: CourseDetailStatus.failure,
        error: e,
      ));
    }
  }

  /// Load resources for a lesson, cached per lesson ID.
  Future<void> loadResources(String lessonId) async {
    if (state.resources.containsKey(lessonId)) return;
    try {
      final resources = await repository.lessonResources(lessonId);
      if (!isClosed) {
        emit(state.copyWith(
          resources: {...state.resources, lessonId: resources},
        ));
      }
    } on ApiException {
      // Resources failing should not break the page.
    }
  }
}
