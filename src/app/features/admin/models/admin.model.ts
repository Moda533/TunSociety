import { User } from '../../user/models/user.model';

export interface AdminTrendPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface AdminOverview {
  totalUsers: number;
  activeUsers: number;
  postsToday: number;
  reportsPending: number;
  warningsIssued: number;
  frozenAccounts: number;
  newUsersThisWeek: number;
  unassignedMembers: number;
  userActivityTrend: AdminTrendPoint[];
  moderationTrend: AdminTrendPoint[];
}

export type AdminStatisticsRange = '7d' | '30d' | '90d';

export interface AdminStatisticsSummary {
  totalUsers: number;
  activeUsers: number;
  flaggedContent: number;
  blockedUsers: number;
  pendingAppeals: number;
  resolvedAppeals: number;
  unassignedMembers: number;
  averageEventRating: number | null;
  eventAttendanceCount: number;
  eventEngagement: number;
  eventEvaluationCount: number;
}

export interface AdminStatisticsTrendPoint {
  date: string;
  users: number;
  flagged: number;
  blocked: number;
  appealsSubmitted: number;
  appealsResolved: number;
  eventEvaluations: number;
  eventAverageRating: number | null;
}

export interface AdminStatisticsOverview {
  range: AdminStatisticsRange;
  summary: AdminStatisticsSummary;
  trends: AdminStatisticsTrendPoint[];
}

export interface AdminEventEvaluationDashboard {
  summary: AdminEventEvaluationSummary;
  events: AdminEventEvaluationEvent[];
  recentFeedback: AdminEventEvaluationFeedback[];
}

export interface AdminEventEvaluationSummary {
  totalEvaluations: number;
  averageRating: number | null;
  eventsWithEvaluations: number;
  pastEventsWithoutEvaluations: number;
  feedbackCount: number;
}

export interface AdminEventEvaluationEvent {
  eventId: string;
  title: string;
  location: string;
  startsAtUtc: string;
  createdByName: string;
  goingCount: number;
  interestedCount: number;
  commentsCount: number;
  evaluationCount: number;
  averageRating: number | null;
  feedbackCount: number;
  latestEvaluationAtUtc: string | null;
  ratingBreakdown: number[];
}

export interface AdminEventEvaluationFeedback {
  id: string;
  eventId: string;
  eventTitle: string;
  userId: string;
  userName: string;
  rating: number;
  feedback: string;
  createdAtUtc: string;
  updatedAtUtc: string | null;
}

export interface AdminUserRiskSummary extends User {
  reportCount: number;
  warningCount: number;
  freezeCount: number;
  appealCount: number;
  openAppealCount: number;
  flaggedPostCount: number;
  flaggedCommentCount: number;
  flaggedDirectMessageCount: number;
  hasBeenFrozen: boolean;
  repeatViolationPattern: boolean;
  riskScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | string;
  lastViolationAtUtc: string | null;
  lastViolationLabel: string | null;
  riskFactors: string[];
}

export type AdminActivityCategory =
  | 'All'
  | 'admin'
  | 'appeal'
  | 'content'
  | 'messaging'
  | 'moderation'
  | 'notification'
  | 'profile'
  | 'social'
  | 'system';

export interface AdminActivityLog {
  id: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorEmail: string | null;
  subjectUserId: string | null;
  subjectDisplayName: string | null;
  subjectEmail: string | null;
  category: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string;
  targetDisplayName: string | null;
  summary: string;
  data: string | null;
  metadata: Record<string, string | null>;
  createdAtUtc: string;
}

export type AdminAuditLog = AdminActivityLog;

export interface AdminActivityFeed {
  items: AdminActivityLog[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface AdminActivityQuery {
  query?: string;
  userId?: string | null;
  userQuery?: string;
  category?: AdminActivityCategory;
  fromUtc?: string;
  toUtc?: string;
  page?: number;
  pageSize?: number;
}

export interface IssueUserActionRequest {
  reason?: string | null;
}

export type ModerationReviewAction = 'Dismiss' | 'Warn' | 'Freeze' | 'Escalate';

export interface ReviewModerationResultRequest {
  action: ModerationReviewAction;
  reason?: string | null;
}

export interface Department {
  id: string;
  name: string;
  description: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  createdById: string;
  createdByName: string | null;
  isArchived: boolean;
  userCount: number;
}

export interface DepartmentRequest {
  name: string;
  description?: string | null;
}

export interface BadgeTitle {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  isArchived: boolean;
  isDefault: boolean;
  userCount: number;
}

export interface BadgeRequest {
  name: string;
  departmentId?: string | null;
}

export interface UpdateUserMembershipRequest {
  departmentId: string | null;
  badgeId: string | null;
}

export interface AdminRolePermissionSet {
  role: string;
  permissions: string[];
}

export interface AdminRolePermissionCatalog {
  roles: string[];
  permissions: string[];
  rolePermissions: AdminRolePermissionSet[];
}

export interface UpdateRolePermissionsRequest {
  permissions: string[];
}
