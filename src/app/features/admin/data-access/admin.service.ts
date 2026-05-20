import { Injectable } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { CommunityPost } from '../../community/models/community.model';
import { User } from '../../user/models/user.model';
import {
  AdminActivityFeed,
  AdminActivityQuery,
  AdminAuditLog,
  AdminEventEvaluationDashboard,
  BadgeRequest,
  BadgeTitle,
  Department,
  DepartmentRequest,
  AdminOverview,
  AdminStatisticsOverview,
  AdminStatisticsRange,
  AdminRolePermissionCatalog,
  AdminRolePermissionSet,
  AdminUserRiskSummary,
  IssueUserActionRequest,
  ReviewModerationResultRequest,
  UpdateUserMembershipRequest
} from '../models/admin.model';
import { FreezeReview, WarningReview } from '../../moderation/models/moderation.model';

@Injectable({ providedIn: 'root' })
export class AdminService {
  constructor(private readonly api: ApiService) {}

  getOverview() {
    return this.api.get<AdminOverview>('admin/overview');
  }

  getStatisticsOverview(range: AdminStatisticsRange) {
    return this.api.get<AdminStatisticsOverview>(`admin/statistics/overview?range=${encodeURIComponent(range)}`);
  }

  getEventEvaluations(take = 24) {
    return this.api.get<AdminEventEvaluationDashboard>(`admin/event-evaluations?take=${take}`);
  }

  getRolePermissions() {
    return this.api.get<AdminRolePermissionCatalog>('admin/role-permissions');
  }

  updateRolePermissions(role: string, permissions: string[]) {
    return this.api.put<AdminRolePermissionSet>(`admin/role-permissions/${encodeURIComponent(role)}`, { permissions });
  }

  getUsers(skip = 0, take = 100) {
    return this.api.get<AdminUserRiskSummary[]>(`admin/users?skip=${skip}&take=${take}`);
  }

  getUnassignedUsers() {
    return this.api.get<AdminUserRiskSummary[]>('admin/users/unassigned');
  }

  getUserRiskSummary(userId: string) {
    return this.api.get<AdminUserRiskSummary>(`admin/users/${userId}/risk-summary`);
  }

  updateUserMembership(userId: string, payload: UpdateUserMembershipRequest) {
    return this.api.put<User>(`admin/users/${userId}/membership`, payload);
  }

  getDepartments(includeArchived = false) {
    return this.api.get<Department[]>(`admin/departments?includeArchived=${includeArchived}`);
  }

  createDepartment(payload: DepartmentRequest) {
    return this.api.post<Department>('admin/departments', payload);
  }

  updateDepartment(departmentId: string, payload: DepartmentRequest) {
    return this.api.put<Department>(`admin/departments/${departmentId}`, payload);
  }

  archiveDepartment(departmentId: string) {
    return this.api.delete<void>(`admin/departments/${departmentId}`);
  }

  getDepartmentUsers(departmentId: string) {
    return this.api.get<AdminUserRiskSummary[]>(`admin/departments/${departmentId}/users`);
  }

  getBadges(includeArchived = false) {
    return this.api.get<BadgeTitle[]>(`admin/badges?includeArchived=${includeArchived}`);
  }

  createBadge(payload: BadgeRequest) {
    return this.api.post<BadgeTitle>('admin/badges', payload);
  }

  updateBadge(badgeId: string, payload: BadgeRequest) {
    return this.api.put<BadgeTitle>(`admin/badges/${badgeId}`, payload);
  }

  deleteBadge(badgeId: string) {
    return this.api.delete<void>(`admin/badges/${badgeId}`);
  }

  getAuditLogs(limit = 50) {
    return this.api.get<AdminAuditLog[]>(`admin/audit-logs?limit=${limit}`);
  }

  getUserAuditLogs(userId: string, limit = 50) {
    return this.api.get<AdminAuditLog[]>(`admin/users/${userId}/audit-logs?limit=${limit}`);
  }

  getActivityFeed(query: AdminActivityQuery = {}) {
    return this.api.get<AdminActivityFeed>(`admin/activity${this.buildActivityQueryString(query)}`);
  }

  getUserActivityFeed(userId: string, query: AdminActivityQuery = {}) {
    return this.api.get<AdminActivityFeed>(`admin/users/${userId}/activity${this.buildActivityQueryString(query)}`);
  }

  getUserPosts(userId: string, take = 12) {
    return this.api.get<CommunityPost[]>(`admin/users/${userId}/posts?take=${take}`);
  }

  issueWarning(userId: string, reason?: string | null) {
    return this.api.post<WarningReview>(`admin/users/${userId}/warnings`, { reason } satisfies IssueUserActionRequest);
  }

  freezeUser(userId: string, reason?: string | null) {
    return this.api.post<FreezeReview>(`admin/users/${userId}/freeze`, { reason } satisfies IssueUserActionRequest);
  }

  unfreezeUser(userId: string) {
    return this.api.post<void>(`admin/users/${userId}/unfreeze`, {});
  }

  reviewModerationResult(moderationResultId: string, payload: ReviewModerationResultRequest) {
    return this.api.post<void>(`admin/moderation/${moderationResultId}/review`, payload);
  }

  private buildActivityQueryString(query: AdminActivityQuery): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      searchParams.set(key, String(value));
    }

    const serialized = searchParams.toString();
    return serialized ? `?${serialized}` : '';
  }
}
