export interface ModerationRequest {
  messageId?: string;
  content: string;
  contentType?: string;
}

export interface ModerationFeedback {
  score: number;
  flags: string[];
  action: string;
  reason?: string | null;
  isSuppressed: boolean;
  warningCount: number;
  suppressionCount: number;
  remainingViolationsBeforeFreeze: number;
  accountFrozen: boolean;
}

export interface SubmissionResult<T> {
  data: T | null;
  moderation: ModerationFeedback;
}

export type FlaggedContentAction = 'Flag' | 'Block';
export type ReviewActionFilter = 'All' | FlaggedContentAction;
export type AppealStatusFilter = 'All' | 'Open' | 'Accepted' | 'Rejected';

export interface ModerationResponse {
  messageId: string;
  score: number;
  flags: string[];
  action: string;
  reason?: string | null;
}

export interface FlaggedContentReview {
  moderationResultId: string;
  contentId: string;
  messageId: string;
  contentType: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  content: string;
  score: number;
  action: string;
  reason?: string | null;
  isEscalated: boolean;
  escalatedAtUtc?: string | null;
  escalationNote?: string | null;
  isReviewed: boolean;
  reviewAction?: string | null;
  reviewActionLabel?: string | null;
  reviewNote?: string | null;
  reviewedAtUtc?: string | null;
  flags: string[];
  createdAtUtc: string;
}

export interface WarningReview {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  reason: string;
  issuedAtUtc: string;
}

export interface FreezeReview {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  reason: string;
  startsAtUtc: string;
  endsAtUtc?: string | null;
  isActive: boolean;
}

export interface AppealReview {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  targetType: string;
  targetId: string;
  status: 'Open' | 'Accepted' | 'Rejected';
  reason?: string | null;
  createdAtUtc: string;
  resolvedAtUtc?: string | null;
}

export interface UpdateAppealStatusRequest {
  status: 'Open' | 'Accepted' | 'Rejected';
}
