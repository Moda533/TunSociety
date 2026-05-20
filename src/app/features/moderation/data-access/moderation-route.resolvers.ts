import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import {
  AppealReview,
  FlaggedContentReview,
  FreezeReview,
  WarningReview
} from '../models/moderation.model';
import { ModerationService } from './moderation.service';

export interface ModerationWorkspaceInitialData {
  flaggedContent: FlaggedContentReview[];
  warnings: WarningReview[];
  freezes: FreezeReview[];
  appeals: AppealReview[];
}

export const moderationWorkspaceResolver: ResolveFn<ModerationWorkspaceInitialData | null> = () => {
  const moderationService = inject(ModerationService);
  const take = 25;

  return forkJoin({
    flaggedContent: moderationService.getFlaggedContent(take),
    warnings: moderationService.getWarnings(take),
    freezes: moderationService.getFreezes(take, false),
    appeals: moderationService.getAppeals(take)
  }).pipe(catchError(() => of(null)));
};
