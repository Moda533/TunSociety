import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { ModerationService } from '../../core/services/moderation.service';
import {
  AppealStatusFilter,
  AppealReview,
  FlaggedContentReview,
  FreezeReview,
  ModerationResponse,
  ReviewActionFilter,
  WarningReview
} from '../../shared/models/moderation.model';

@Component({
  selector: 'app-moderation',
  standalone: false,
  templateUrl: './moderation.component.html',
  styleUrls: ['./moderation.component.scss']
})
export class ModerationComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly moderationService = inject(ModerationService);

  readonly reviewTake = 25;
  isSubmitting = false;
  isLoadingReviews = false;
  updatingAppealId = '';
  errorMessage = '';
  reviewErrorMessage = '';
  result: ModerationResponse | null = null;
  flaggedContent: FlaggedContentReview[] = [];
  warnings: WarningReview[] = [];
  freezes: FreezeReview[] = [];
  appeals: AppealReview[] = [];

  readonly form = this.fb.nonNullable.group({
    content: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(4000)]]
  });

  readonly reviewFilters = this.fb.nonNullable.group({
    flaggedAction: 'All' as ReviewActionFilter,
    appealStatus: 'All' as AppealStatusFilter,
    activeFreezesOnly: false
  });

  ngOnInit(): void {
    this.loadReviewData();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.form.getRawValue();
    this.isSubmitting = true;
    this.errorMessage = '';
    this.result = null;

    this.moderationService.score(payload)
      .pipe(finalize(() => {
        this.isSubmitting = false;
      }))
      .subscribe({
        next: (response) => {
          this.result = response;
        },
        error: () => {
          this.errorMessage = 'Unable to score the message right now.';
        }
      });
  }

  refreshReviews(): void {
    this.loadReviewData();
  }

  updateAppealStatus(appealId: string, status: AppealReview['status']): void {
    if (this.updatingAppealId) {
      return;
    }

    this.updatingAppealId = appealId;
    this.reviewErrorMessage = '';

    this.moderationService.updateAppealStatus(appealId, { status })
      .pipe(finalize(() => {
        this.updatingAppealId = '';
      }))
      .subscribe({
        next: () => {
          this.loadReviewData();
        },
        error: () => {
          this.reviewErrorMessage = 'Unable to update appeal status right now.';
        }
      });
  }

  formatContentType(contentType: string): string {
    return contentType.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  trackFlaggedContent(_: number, item: FlaggedContentReview): string {
    return item.moderationResultId;
  }

  private loadReviewData(): void {
    this.isLoadingReviews = true;
    this.reviewErrorMessage = '';
    const flaggedAction = this.reviewFilters.controls.flaggedAction.value;
    const appealStatus = this.reviewFilters.controls.appealStatus.value;
    const activeFreezesOnly = this.reviewFilters.controls.activeFreezesOnly.value;

    forkJoin({
      flaggedContent: this.moderationService.getFlaggedContent(
        this.reviewTake,
        flaggedAction === 'All' ? undefined : flaggedAction
      ),
      warnings: this.moderationService.getWarnings(this.reviewTake),
      freezes: this.moderationService.getFreezes(this.reviewTake, activeFreezesOnly),
      appeals: this.moderationService.getAppeals(
        this.reviewTake,
        appealStatus === 'All' ? undefined : appealStatus
      )
    })
      .pipe(finalize(() => {
        this.isLoadingReviews = false;
      }))
      .subscribe({
        next: ({ flaggedContent, warnings, freezes, appeals }) => {
          this.flaggedContent = flaggedContent;
          this.warnings = warnings;
          this.freezes = freezes;
          this.appeals = appeals;
        },
        error: () => {
          this.reviewErrorMessage = 'Unable to load moderation review data.';
        }
      });
  }
}
