import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/courses_repository.dart';
import '../data/models/course.dart';

/// State for the courses listing page.
class CoursesState extends Equatable {
  const CoursesState({
    this.status = CoursesStatus.loading,
    this.courses = const [],
    this.error,
    this.query = '',
  });

  final CoursesStatus status;
  final List<Course> courses;
  final ApiException? error;
  final String query;

  List<Course> get filtered {
    if (query.isEmpty) return courses;
    final q = query.toLowerCase();
    return courses.where((c) {
      return c.subject.name.toLowerCase().contains(q) ||
          c.subject.code.toLowerCase().contains(q) ||
          c.section.name.toLowerCase().contains(q) ||
          c.section.code.toLowerCase().contains(q) ||
          c.teachers.any((t) => t.toLowerCase().contains(q));
    }).toList();
  }

  CoursesState copyWith({
    CoursesStatus? status,
    List<Course>? courses,
    ApiException? error,
    String? query,
    bool clearError = false,
  }) =>
      CoursesState(
        status: status ?? this.status,
        courses: courses ?? this.courses,
        error: clearError ? null : (error ?? this.error),
        query: query ?? this.query,
      );

  @override
  List<Object?> get props => [status, courses, error, query];
}

enum CoursesStatus { loading, loaded, failure }

/// Cubit for the courses listing page.
class CoursesCubit extends Cubit<CoursesState> {
  CoursesCubit({required this.repository}) : super(const CoursesState());

  final CoursesRepository repository;

  Future<void> load() async {
    emit(state.copyWith(status: CoursesStatus.loading, clearError: true));
    try {
      final courses = await repository.listCourses();
      emit(state.copyWith(
        status: CoursesStatus.loaded,
        courses: courses,
      ));
    } on ApiException catch (e) {
      emit(state.copyWith(
        status: CoursesStatus.failure,
        error: e,
      ));
    }
  }

  void updateQuery(String query) {
    emit(state.copyWith(query: query));
  }
}
