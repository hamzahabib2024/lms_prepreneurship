import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/partner_portal_repository.dart';

class PartnerPortalCubit extends Cubit<PartnerPortalState> {
  PartnerPortalCubit({required this.repository})
      : super(const PartnerPortalState());

  final PartnerPortalRepository repository;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final me = await repository.getMe();
      if (isClosed) return;
      emit(state.copyWith(loading: false, me: me));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  Future<void> loadStudents({String? query}) async {
    if (state.loadingStudents) return;
    emit(state.copyWith(loadingStudents: true, studentsError: null));
    try {
      final students = await repository.getStudents(query: query);
      if (isClosed) return;
      emit(state.copyWith(loadingStudents: false, students: students));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingStudents: false, studentsError: error));
    }
  }

  Future<void> loadStudentDetail(String id) async {
    if (state.loadingStudentDetail) return;
    emit(state.copyWith(loadingStudentDetail: true, studentDetailError: null));
    try {
      final detail = await repository.getStudentDetail(id);
      if (isClosed) return;
      emit(state.copyWith(loadingStudentDetail: false, studentDetail: detail));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingStudentDetail: false, studentDetailError: error));
    }
  }

  void selectStudent(String? id) {
    emit(state.copyWith(
      selectedStudentId: id,
      studentDetail: null,
    ));
    if (id != null) loadStudentDetail(id);
  }

  void setTab(String tab) {
    emit(state.copyWith(selectedTab: tab, selectedStudentId: null, studentDetail: null));
    if (tab == 'students') loadStudents();
  }
}

class PartnerPortalState extends Equatable {
  const PartnerPortalState({
    this.loading = false,
    this.me,
    this.error,
    this.selectedTab = 'students',
    this.loadingStudents = false,
    this.students = const [],
    this.studentsError,
    this.selectedStudentId,
    this.loadingStudentDetail = false,
    this.studentDetail,
    this.studentDetailError,
  });

  final bool loading;
  final PartnerMe? me;
  final ApiException? error;
  final String selectedTab;
  final bool loadingStudents;
  final List<PartnerStudentRow> students;
  final ApiException? studentsError;
  final String? selectedStudentId;
  final bool loadingStudentDetail;
  final PartnerStudentDetail? studentDetail;
  final ApiException? studentDetailError;

  bool get seesInvoices => me?.seesInvoices ?? false;

  PartnerPortalState copyWith({
    bool? loading,
    PartnerMe? me,
    ApiException? error,
    String? selectedTab,
    bool? loadingStudents,
    List<PartnerStudentRow>? students,
    ApiException? studentsError,
    String? selectedStudentId,
    bool clearSelectedStudentId = false,
    bool? loadingStudentDetail,
    PartnerStudentDetail? studentDetail,
    ApiException? studentDetailError,
  }) {
    return PartnerPortalState(
      loading: loading ?? this.loading,
      me: me ?? this.me,
      error: error,
      selectedTab: selectedTab ?? this.selectedTab,
      loadingStudents: loadingStudents ?? this.loadingStudents,
      students: students ?? this.students,
      studentsError: studentsError,
      selectedStudentId: clearSelectedStudentId
          ? null
          : (selectedStudentId ?? this.selectedStudentId),
      loadingStudentDetail: loadingStudentDetail ?? this.loadingStudentDetail,
      studentDetail: studentDetail ?? this.studentDetail,
      studentDetailError: studentDetailError,
    );
  }

  @override
  List<Object?> get props => [
        loading,
        me,
        error,
        selectedTab,
        loadingStudents,
        students,
        studentsError,
        selectedStudentId,
        loadingStudentDetail,
        studentDetail,
        studentDetailError,
      ];
}
