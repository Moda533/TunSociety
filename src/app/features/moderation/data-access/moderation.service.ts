import { Injectable } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import {
  AppealStatusFilter,
  AppealReview,
  FlaggedContentAction,
  FlaggedContentReview,
  FreezeReview,
  ModerationRequest,
  ModerationResponse,
  UpdateAppealStatusRequest,
  WarningReview
} from '../models/moderation.model';

@Injectable({ providedIn: 'root' })
export class ModerationService {
  constructor(private readonly api: ApiService) {}

  score(payload: ModerationRequest) {
    return this.api.post<ModerationResponse>('moderation/score', payload);
  }

  getFlaggedContent(take = 25, action?: FlaggedContentAction, userId?: string, escalatedOnly?: boolean) {
    const params = [`take=${take}`];
    if (action) {
      params.push(`action=${encodeURIComponent(action)}`);
    }
    if (userId) {
      params.push(`userId=${encodeURIComponent(userId)}`);
    }
    if (escalatedOnly) {
      params.push('escalatedOnly=true');
    }

    return this.api.get<FlaggedContentReview[]>(`moderation/flagged-content?${params.join('&')}`);
  }

  getWarnings(take = 25, userId?: string) {
    const params = [`take=${take}`];
    if (userId) {
      params.push(`userId=${encodeURIComponent(userId)}`);
    }

    return this.api.get<WarningReview[]>(`moderation/warnings?${params.join('&')}`);
  }

  getFreezes(take = 25, activeOnly = false, userId?: string) {
    const params = [`take=${take}`, `activeOnly=${activeOnly}`];
    if (userId) {
      params.push(`userId=${encodeURIComponent(userId)}`);
    }

    return this.api.get<FreezeReview[]>(`moderation/freezes?${params.join('&')}`);
  }

  getAppeals(take = 25, status?: Exclude<AppealStatusFilter, 'All'>, userId?: string) {
    const params = [`take=${take}`];
    if (status) {
      params.push(`status=${encodeURIComponent(status)}`);
    }
    if (userId) {
      params.push(`userId=${encodeURIComponent(userId)}`);
    }

    return this.api.get<AppealReview[]>(`moderation/appeals?${params.join('&')}`);
  }

  updateAppealStatus(appealId: string, payload: UpdateAppealStatusRequest) {
    return this.api.put<AppealReview>(`moderation/appeals/${appealId}/status`, payload);
  }
}
