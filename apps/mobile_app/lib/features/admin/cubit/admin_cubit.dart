import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/network/api_exception.dart';
import '../data/admin_repository.dart';
import '../data/models/audit_entry.dart';
import '../data/models/backup_item.dart';
import '../data/models/password_reset_result.dart';
import '../data/models/security_event.dart';
import '../data/models/setting_group.dart';
import '../data/models/staff_creation_result.dart';
import '../data/models/user_directory_item.dart';

class AdminCubit extends Cubit<AdminState> {
  AdminCubit({required this.repository}) : super(const AdminState());

  final AdminRepository repository;

  // -------------------------------------------------------- user directory ---

  Future<void> loadUsers({int page = 1}) async {
    if (state.loadingUsers) return;
    emit(state.copyWith(loadingUsers: true, usersError: null));
    try {
      final result = await repository.listUsers(
        role: state.roleFilter,
        status: state.statusFilter,
        q: state.searchQuery.isEmpty ? null : state.searchQuery,
        page: page,
      );
      if (isClosed) return;
      final users = result['users'] as List<UserDirectoryItem>;
      final pag = result['pagination'] as Map<String, dynamic>;
      emit(state.copyWith(
        users: users,
        loadingUsers: false,
        currentPage: pag['page'] as int? ?? 1,
        totalPages: pag['totalPages'] as int? ?? 1,
        totalItems: pag['totalItems'] as int? ?? 0,
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingUsers: false, usersError: error));
    }
  }

  void setUserFilter(String? role) {
    emit(state.copyWith(roleFilter: role, currentPage: 1));
    loadUsers(page: 1);
  }

  void setStatusFilter(String? status) {
    emit(state.copyWith(statusFilter: status, currentPage: 1));
    loadUsers(page: 1);
  }

  void setSearchQuery(String query) {
    emit(state.copyWith(searchQuery: query, currentPage: 1));
  }

  void selectUser(UserDirectoryItem user) {
    emit(state.copyWith(selectedUser: user));
  }

  void clearSelectedUser() {
    emit(state.copyWith(clearSelectedUser: true));
  }

  Future<void> createStaff({
    required String email,
    required String fullName,
    String? phone,
    required String role,
    List<String>? subPermissions,
    String? employeeCode,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.createStaff(
        email: email,
        fullName: fullName,
        phone: phone,
        role: role,
        subPermissions: subPermissions,
        employeeCode: employeeCode,
      );
      if (isClosed) return;
      emit(state.copyWith(busy: false, staffCreationResult: result));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> suspendUser({required String id, required String reason}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.setUserStatus(id: id, status: 'SUSPENDED', reason: reason);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Account suspended'));
      await loadUsers(page: state.currentPage);
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> reactivateUser({required String id, required String reason}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.setUserStatus(id: id, status: 'ACTIVE', reason: reason);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Account reactivated'));
      await loadUsers(page: state.currentPage);
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> resetPassword({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.resetPassword(id: id);
      if (isClosed) return;
      emit(state.copyWith(busy: false, passwordResetResult: result));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> revokeSessions({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.revokeSessions(id: id);
      if (isClosed) return;
      final count = result['revoked'] as int? ?? 0;
      emit(state.copyWith(busy: false, actionSuccess: '$count session${count == 1 ? '' : 's'} revoked'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> unlockAccount({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.unlockAccount(id: id);
      if (isClosed) return;
      final msg = result['message'] as String? ?? 'Account unlocked';
      emit(state.copyWith(busy: false, actionSuccess: msg));
      await loadUsers(page: state.currentPage);
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  // ------------------------------------------------------------ settings ---

  Future<void> loadSettings() async {
    if (state.loadingSettings) return;
    emit(state.copyWith(loadingSettings: true, settingsError: null));
    try {
      final groups = await repository.listSettings();
      if (isClosed) return;
      emit(state.copyWith(settingGroups: groups, loadingSettings: false));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingSettings: false, settingsError: error));
    }
  }

  Future<void> updateSetting({
    required String key,
    required dynamic value,
  }) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.updateSetting(key: key, value: value);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Setting updated'));
      await loadSettings();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> restoreSetting({required String key}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.deleteSetting(key: key);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Setting restored to default'));
      await loadSettings();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void setSettingsSearch(String query) {
    emit(state.copyWith(settingsSearch: query));
  }

  // ------------------------------------------------------------ backups ---

  Future<void> loadBackups() async {
    if (state.loadingBackups) return;
    emit(state.copyWith(loadingBackups: true, backupsError: null));
    try {
      final backups = await repository.listBackups();
      if (isClosed) return;
      emit(state.copyWith(backups: backups, loadingBackups: false));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingBackups: false, backupsError: error));
    }
  }

  Future<void> createBackup() async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.createBackup();
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Backup created'));
      await loadBackups();
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> restoreBackup({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.restoreBackup(id: id);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Backup restored. Turn maintenance mode off when ready.'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> verifyBackup({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final result = await repository.verifyBackup(id: id);
      if (isClosed) return;
      final ok = result['ok'] == true || result['valid'] == true;
      emit(state.copyWith(
        busy: false,
        actionSuccess: ok ? 'Backup verified successfully' : 'Backup verification failed',
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> downloadBackup({required String id}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.downloadBackupUrl(id: id);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Download link ready'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  // ------------------------------------------------------------ audit ---

  Future<void> loadAuditLog({int page = 1}) async {
    if (state.loadingAudit) return;
    emit(state.copyWith(loadingAudit: true, auditError: null));
    try {
      final result = await repository.listAuditLog(
        action: state.auditActionFilter,
        entityType: state.auditEntityFilter,
        from: state.auditFromDate,
        to: state.auditToDate,
        page: page,
      );
      if (isClosed) return;
      final entries = result['entries'] as List<AuditEntry>;
      final pag = result['pagination'] as Map<String, dynamic>;
      emit(state.copyWith(
        auditEntries: entries,
        loadingAudit: false,
        auditPage: pag['page'] as int? ?? 1,
        auditTotalPages: pag['totalPages'] as int? ?? 1,
        auditTotalItems: pag['totalItems'] as int? ?? 0,
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingAudit: false, auditError: error));
    }
  }

  Future<void> loadAuditActions() async {
    try {
      final actions = await repository.listAuditActions();
      if (isClosed) return;
      emit(state.copyWith(auditActions: actions));
    } on ApiException {
      // non-critical
    }
  }

  void setAuditActionFilter(String? action) {
    emit(state.copyWith(
      auditActionFilter: action,
      clearAuditActionFilter: action == null,
    ));
    loadAuditLog(page: 1);
  }

  void setAuditEntityFilter(String? entity) {
    emit(state.copyWith(
      auditEntityFilter: entity,
      clearAuditEntityFilter: entity == null,
    ));
    loadAuditLog(page: 1);
  }

  void setAuditDateRange({String? from, String? to}) {
    emit(state.copyWith(
      auditFromDate: from,
      clearAuditFromDate: from == null,
      auditToDate: to,
      clearAuditToDate: to == null,
    ));
    loadAuditLog(page: 1);
  }

  // ------------------------------------------------------------ security ---

  Future<void> loadSecurityOverview() async {
    if (state.loadingSecurity) return;
    emit(state.copyWith(loadingSecurity: true, securityError: null));
    try {
      final overview = await repository.getSecurityOverview();
      if (isClosed) return;
      emit(state.copyWith(securityOverview: overview, loadingSecurity: false));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingSecurity: false, securityError: error));
    }
  }

  Future<void> loadSecurityEvents({int page = 1}) async {
    if (state.loadingSecurityEvents) return;
    emit(state.copyWith(loadingSecurityEvents: true));
    try {
      final result = await repository.listSecurityEvents(page: page);
      if (isClosed) return;
      final events = result['events'] as List<SecurityEvent>;
      final pag = result['pagination'] as Map<String, dynamic>;
      emit(state.copyWith(
        securityEvents: events,
        loadingSecurityEvents: false,
        securityPage: pag['page'] as int? ?? 1,
        securityTotalPages: pag['totalPages'] as int? ?? 1,
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(loadingSecurityEvents: false, securityError: error));
    }
  }

  // ------------------------------------------------------------ maintenance ---

  Future<void> loadMaintenance() async {
    try {
      final data = await repository.getMaintenance();
      if (isClosed) return;
      emit(state.copyWith(maintenanceEnabled: data['enabled'] as bool? ?? false));
    } on ApiException {
      // silently fail — non-critical
    }
  }

  Future<void> setMaintenance({required bool enabled}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.setMaintenance(enabled: enabled);
      if (isClosed) return;
      emit(state.copyWith(
        busy: false,
        maintenanceEnabled: enabled,
        actionSuccess: enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
      ));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  // ------------------------------------------------------------ common ---

  void dismissResult() {
    emit(state.copyWith(
      clearActionSuccess: true,
      clearActionError: true,
      clearStaffCreationResult: true,
      clearPasswordResetResult: true,
    ));
  }

  // ── GDPR / Personal Data ──

  Future<void> exportPersonalData({required String userId}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final data = await repository.exportPersonalData(userId: userId);
      if (isClosed) return;
      emit(state.copyWith(busy: false, personalDataExport: data));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> getErasurePlan({required String userId}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      final data = await repository.getErasurePlan(userId: userId);
      if (isClosed) return;
      emit(state.copyWith(busy: false, erasurePlan: data));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  Future<void> erasePersonalData({required String userId}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.erasePersonalData(userId: userId);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Personal data erased'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  // ── Impersonation ──

  Future<void> impersonate({required String userId}) async {
    if (state.busy) return;
    emit(state.copyWith(busy: true, actionError: null));
    try {
      await repository.impersonate(userId: userId);
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionSuccess: 'Impersonation started. Restart the app to stop.'));
    } on ApiException catch (error) {
      if (isClosed) return;
      emit(state.copyWith(busy: false, actionError: error));
    }
  }

  void clearErasurePlan() => emit(state.copyWith(clearErasurePlan: true));
  void clearPersonalDataExport() => emit(state.copyWith(clearPersonalDataExport: true));
}

class AdminState extends Equatable {
  const AdminState({
    this.users = const [],
    this.loadingUsers = false,
    this.usersError,
    this.currentPage = 1,
    this.totalPages = 1,
    this.totalItems = 0,
    this.roleFilter,
    this.statusFilter,
    this.searchQuery = '',
    this.selectedUser,
    this.busy = false,
    this.actionError,
    this.actionSuccess,
    this.staffCreationResult,
    this.passwordResetResult,
    this.settingGroups = const [],
    this.loadingSettings = false,
    this.settingsError,
    this.settingsSearch = '',
    this.auditActions = const [],
    this.auditActionFilter,
    this.auditEntityFilter,
    this.auditFromDate,
    this.auditToDate,
    this.backups = const [],
    this.loadingBackups = false,
    this.backupsError,
    this.auditEntries = const [],
    this.loadingAudit = false,
    this.auditError,
    this.auditPage = 1,
    this.auditTotalPages = 1,
    this.auditTotalItems = 0,
    this.securityOverview,
    this.securityEvents = const [],
    this.loadingSecurity = false,
    this.loadingSecurityEvents = false,
    this.securityError,
    this.securityPage = 1,
    this.securityTotalPages = 1,
    this.maintenanceEnabled = false,
    this.personalDataExport,
    this.erasurePlan,
  });

  final List<UserDirectoryItem> users;
  final bool loadingUsers;
  final ApiException? usersError;
  final int currentPage;
  final int totalPages;
  final int totalItems;
  final String? roleFilter;
  final String? statusFilter;
  final String searchQuery;
  final UserDirectoryItem? selectedUser;

  final bool busy;
  final ApiException? actionError;
  final String? actionSuccess;
  final StaffCreationResult? staffCreationResult;
  final PasswordResetResult? passwordResetResult;

  final List<SettingGroup> settingGroups;
  final bool loadingSettings;
  final ApiException? settingsError;
  final String settingsSearch;
  final List<AuditActionCount> auditActions;
  final String? auditActionFilter;
  final String? auditEntityFilter;
  final String? auditFromDate;
  final String? auditToDate;

  final List<BackupItem> backups;
  final bool loadingBackups;
  final ApiException? backupsError;

  final List<AuditEntry> auditEntries;
  final bool loadingAudit;
  final ApiException? auditError;
  final int auditPage;
  final int auditTotalPages;
  final int auditTotalItems;

  final SecurityOverview? securityOverview;
  final List<SecurityEvent> securityEvents;
  final bool loadingSecurity;
  final bool loadingSecurityEvents;
  final ApiException? securityError;
  final int securityPage;
  final int securityTotalPages;

  final bool maintenanceEnabled;

  final Map<String, dynamic>? personalDataExport;
  final Map<String, dynamic>? erasurePlan;

  AdminState copyWith({
    List<UserDirectoryItem>? users,
    bool? loadingUsers,
    ApiException? usersError,
    int? currentPage,
    int? totalPages,
    int? totalItems,
    String? roleFilter,
    String? statusFilter,
    String? searchQuery,
    UserDirectoryItem? selectedUser,
    bool clearSelectedUser = false,
    bool? busy,
    ApiException? actionError,
    String? actionSuccess,
    bool clearActionSuccess = false,
    bool clearActionError = false,
    StaffCreationResult? staffCreationResult,
    bool clearStaffCreationResult = false,
    PasswordResetResult? passwordResetResult,
    bool clearPasswordResetResult = false,
    List<SettingGroup>? settingGroups,
    bool? loadingSettings,
    ApiException? settingsError,
    String? settingsSearch,
    List<AuditActionCount>? auditActions,
    String? auditActionFilter,
    bool clearAuditActionFilter = false,
    String? auditEntityFilter,
    bool clearAuditEntityFilter = false,
    String? auditFromDate,
    bool clearAuditFromDate = false,
    String? auditToDate,
    bool clearAuditToDate = false,
    List<BackupItem>? backups,
    bool? loadingBackups,
    ApiException? backupsError,
    List<AuditEntry>? auditEntries,
    bool? loadingAudit,
    ApiException? auditError,
    int? auditPage,
    int? auditTotalPages,
    int? auditTotalItems,
    SecurityOverview? securityOverview,
    List<SecurityEvent>? securityEvents,
    bool? loadingSecurity,
    bool? loadingSecurityEvents,
    ApiException? securityError,
    int? securityPage,
    int? securityTotalPages,
    bool? maintenanceEnabled,
    Map<String, dynamic>? personalDataExport,
    bool clearPersonalDataExport = false,
    Map<String, dynamic>? erasurePlan,
    bool clearErasurePlan = false,
  }) {
    return AdminState(
      users: users ?? this.users,
      loadingUsers: loadingUsers ?? this.loadingUsers,
      usersError: usersError,
      currentPage: currentPage ?? this.currentPage,
      totalPages: totalPages ?? this.totalPages,
      totalItems: totalItems ?? this.totalItems,
      roleFilter: roleFilter ?? this.roleFilter,
      statusFilter: statusFilter ?? this.statusFilter,
      searchQuery: searchQuery ?? this.searchQuery,
      selectedUser: clearSelectedUser ? null : (selectedUser ?? this.selectedUser),
      busy: busy ?? this.busy,
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      actionSuccess: clearActionSuccess ? null : (actionSuccess ?? this.actionSuccess),
      staffCreationResult:
          clearStaffCreationResult ? null : (staffCreationResult ?? this.staffCreationResult),
      passwordResetResult:
          clearPasswordResetResult ? null : (passwordResetResult ?? this.passwordResetResult),
      settingGroups: settingGroups ?? this.settingGroups,
      loadingSettings: loadingSettings ?? this.loadingSettings,
      settingsError: settingsError,
      settingsSearch: settingsSearch ?? this.settingsSearch,
      auditActions: auditActions ?? this.auditActions,
      auditActionFilter: clearAuditActionFilter ? null : (auditActionFilter ?? this.auditActionFilter),
      auditEntityFilter: clearAuditEntityFilter ? null : (auditEntityFilter ?? this.auditEntityFilter),
      auditFromDate: clearAuditFromDate ? null : (auditFromDate ?? this.auditFromDate),
      auditToDate: clearAuditToDate ? null : (auditToDate ?? this.auditToDate),
      backups: backups ?? this.backups,
      loadingBackups: loadingBackups ?? this.loadingBackups,
      backupsError: backupsError,
      auditEntries: auditEntries ?? this.auditEntries,
      loadingAudit: loadingAudit ?? this.loadingAudit,
      auditError: auditError,
      auditPage: auditPage ?? this.auditPage,
      auditTotalPages: auditTotalPages ?? this.auditTotalPages,
      auditTotalItems: auditTotalItems ?? this.auditTotalItems,
      securityOverview: securityOverview ?? this.securityOverview,
      securityEvents: securityEvents ?? this.securityEvents,
      loadingSecurity: loadingSecurity ?? this.loadingSecurity,
      loadingSecurityEvents: loadingSecurityEvents ?? this.loadingSecurityEvents,
      securityError: securityError,
      securityPage: securityPage ?? this.securityPage,
      securityTotalPages: securityTotalPages ?? this.securityTotalPages,
      maintenanceEnabled: maintenanceEnabled ?? this.maintenanceEnabled,
      personalDataExport: clearPersonalDataExport ? null : (personalDataExport ?? this.personalDataExport),
      erasurePlan: clearErasurePlan ? null : (erasurePlan ?? this.erasurePlan),
    );
  }

  @override
  List<Object?> get props => [
        users, loadingUsers, usersError, currentPage, totalPages, totalItems,
        roleFilter, statusFilter, searchQuery, selectedUser,
        busy, actionError, actionSuccess, staffCreationResult, passwordResetResult,
        settingGroups, loadingSettings, settingsError, settingsSearch,
        auditActions, auditActionFilter, auditEntityFilter, auditFromDate, auditToDate,
        backups, loadingBackups, backupsError,
        auditEntries, loadingAudit, auditError, auditPage, auditTotalPages, auditTotalItems,
        securityOverview, securityEvents, loadingSecurity, loadingSecurityEvents,
        securityError, securityPage, securityTotalPages,
        maintenanceEnabled, personalDataExport, erasurePlan,
      ];
}
