import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { CommunityPost } from '../../community/models/community.model';
import {
  AppealReview,
  FlaggedContentReview,
  FreezeReview,
  WarningReview
} from '../../moderation/models/moderation.model';
import { ModerationService } from '../../moderation/data-access/moderation.service';
import { User } from '../../user/models/user.model';
import { UserService } from '../../user/data-access/user.service';
import {
  AdminStatisticsOverview,
  AdminUserRiskSummary
} from '../models/admin.model';
import { AdminService } from './admin.service';

export interface AdminStatisticsOverviewInitialData {
  overview: AdminStatisticsOverview;
  riskUsers: AdminUserRiskSummary[];
}

export interface AdminUserDetailInitialData {
  user: User;
  riskSummary: AdminUserRiskSummary;
  posts: CommunityPost[];
  warnings: WarningReview[];
  freezes: FreezeReview[];
  appeals: AppealReview[];
  flaggedContent: FlaggedContentReview[];
}

export const adminUsersResolver: ResolveFn<AdminUserRiskSummary[] | null> = () => {
  return inject(AdminService).getUsers(0, 200).pipe(catchError(() => of(null)));
};

export const adminStatisticsOverviewResolver: ResolveFn<AdminStatisticsOverviewInitialData | null> = () => {
  const adminService = inject(AdminService);

  return forkJoin({
    overview: adminService.getStatisticsOverview('30d'),
    riskUsers: adminService.getUsers(0, 200)
  }).pipe(catchError(() => of(null)));
};

export const adminModerationQueueResolver: ResolveFn<FlaggedContentReview[] | null> = () => {
  return inject(ModerationService).getFlaggedContent(100).pipe(catchError(() => of(null)));
};

export const adminAppealsResolver: ResolveFn<AppealReview[] | null> = () => {
  return inject(ModerationService).getAppeals(100).pipe(catchError(() => of(null)));
};

export const adminUserDetailResolver: ResolveFn<AdminUserDetailInitialData | null> = (route) => {
  const userId = route.paramMap.get('userId') ?? route.paramMap.get('id') ?? '';

  if (!userId) {
    return of(null);
  }

  const adminService = inject(AdminService);
  const moderationService = inject(ModerationService);
  const userService = inject(UserService);

  return userService.getById(userId).pipe(
    switchMap((user) => forkJoin({
      user: of(user),
      riskSummary: adminService.getUserRiskSummary(userId).pipe(catchError(() => of(buildFallbackRiskSummary(user)))),
      posts: adminService.getUserPosts(userId, 12).pipe(catchError(() => of([]))),
      warnings: moderationService.getWarnings(20, userId).pipe(catchError(() => of([]))),
      freezes: moderationService.getFreezes(20, false, userId).pipe(catchError(() => of([]))),
      appeals: moderationService.getAppeals(20, undefined, userId).pipe(catchError(() => of([]))),
      flaggedContent: moderationService.getFlaggedContent(20, undefined, userId).pipe(catchError(() => of([])))
    })),
    catchError(() => of(null))
  );
};

export function buildFallbackRiskSummary(user: User): AdminUserRiskSummary {
  return {
    ...user,
    reportCount: 0,
    warningCount: 0,
    freezeCount: 0,
    appealCount: 0,
    openAppealCount: 0,
    flaggedPostCount: 0,
    flaggedCommentCount: 0,
    flaggedDirectMessageCount: 0,
    hasBeenFrozen: user.isFrozen,
    repeatViolationPattern: false,
    riskScore: 0,
    riskLevel: 'Low',
    lastViolationAtUtc: null,
    lastViolationLabel: null,
    riskFactors: []
  };
}
