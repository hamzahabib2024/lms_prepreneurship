import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';

class CourseHierarchyItem {
  const CourseHierarchyItem({
    required this.id,
    required this.name,
    required this.code,
    this.description,
    this.children = const [],
    this.type = '',
  });

  final String id;
  final String name;
  final String code;
  final String? description;
  final List<CourseHierarchyItem> children;
  final String type;

  factory CourseHierarchyItem.fromJson(Map<String, dynamic> json) {
    return CourseHierarchyItem(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      code: json['code'] as String? ?? '',
      description: json['description'] as String?,
      type: json['type'] as String? ?? '',
      children: (json['children'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CourseHierarchyItem.fromJson)
          .toList(),
    );
  }
}

class CourseHierarchyCubit extends Cubit<CourseHierarchyState> {
  CourseHierarchyCubit({required this.api}) : super(const CourseHierarchyState());

  final ApiClient api;

  Future<void> load() async {
    if (state.loading) return;
    emit(state.copyWith(loading: true, error: null));
    try {
      final programmes = await api.get<List<dynamic>>('/programmes');
      final items = programmes
          .whereType<Map<String, dynamic>>()
          .map(CourseHierarchyItem.fromJson)
          .toList();
      if (isClosed) return;
      emit(state.copyWith(loading: false, programmes: items));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loading: false, error: error));
    }
  }

  void toggleExpanded(String id) {
    final expanded = Set<String>.from(state.expandedIds);
    if (expanded.contains(id)) {
      expanded.remove(id);
    } else {
      expanded.add(id);
    }
    emit(state.copyWith(expandedIds: expanded));
  }
}

class CourseHierarchyState extends Equatable {
  const CourseHierarchyState({
    this.loading = false,
    this.programmes = const [],
    this.error,
    this.expandedIds = const {},
  });

  final bool loading;
  final List<CourseHierarchyItem> programmes;
  final ApiException? error;
  final Set<String> expandedIds;

  CourseHierarchyState copyWith({
    bool? loading,
    List<CourseHierarchyItem>? programmes,
    ApiException? error,
    Set<String>? expandedIds,
  }) {
    return CourseHierarchyState(
      loading: loading ?? this.loading,
      programmes: programmes ?? this.programmes,
      error: error,
      expandedIds: expandedIds ?? this.expandedIds,
    );
  }

  @override
  List<Object?> get props => [loading, programmes, error, expandedIds];
}
