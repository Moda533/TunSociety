import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
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
} from '../../shared/models/moderation.model';

@Injectable({ providedIn: 'root' })
export class ModerationService {
  constructor(private readonly api: ApiService) {}

  score(payload: ModerationRequest) {
    return this.api.post<ModerationResponse>('moderation/score', payload);
  }

  getFlaggedContent(take = 25, action?: FlaggedContentAction) {
    const params = [`take=${take}`];
    if (action) {
      params.push(`action=${encodeURIComponent(action)}`);
    }

    return this.api.get<FlaggedContentReview[]>(`moderation/flagged-content?${params.join('&')}`);
  }

  getWarnings(take = 25) {
    return this.api.get<WarningReview[]>(`moderation/warnings?take=${take}`);
  }

  getFreezes(take = 25, activeOnly = false) {
    return this.api.get<FreezeReview[]>(`moderation/freezes?take=${take}&activeOnly=${activeOnly}`);
  }

  getAppeals(take = 25, status?: Exclude<AppealStatusFilter, 'All'>) {
    const params = [`take=${take}`];
    if (status) {
      params.push(`status=${encodeURIComponent(status)}`);
    }

    return this.api.get<AppealReview[]>(`moderation/appeals?${params.join('&')}`);
  }

  updateAppealStatus(appealId: string, payload: UpdateAppealStatusRequest) {
    return this.api.put<AppealReview>(`moderation/appeals/${appealId}/status`, payload);
  }
}
