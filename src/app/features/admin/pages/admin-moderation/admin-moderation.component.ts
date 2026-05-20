import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { AdminService } from '../../data-access/admin.service';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { ModerationReviewAction } from '../../models/admin.model';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { ModerationService } from '../../../moderation/data-access/moderation.service';
import { FlaggedContentReview, ReviewActionFilter } from '../../../moderation/models/moderation.model';

@Component({
  selector: 'app-admin-moderation',
  standalone: false,
  templateUrl: './admin-moderation.component.html',
  styleUrls: ['./admin-moderation.component.scss']
})
export class AdminModerationComponent implements OnInit, OnDestroy {
  readonly queueFilterOptions: readonly AdminSelectOption[] = [
    { value: 'All', label: 'All' },
    { value: 'Flag', label: 'Flagged' },
    { value: 'Block', label: 'Blocked' }
  ];
  readonly queueFilterControl = new FormControl<ReviewActionFilter>('All', { nonNullable: true });
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly noteControl = new FormControl('', { nonNullable: true });

  flaggedContent: FlaggedContentReview[] = [];
  selectedModerationResultId = '';
  isLoading = false;
  isReviewing = false;
  errorMessage = '';
  actionMessage = '';
  lastRefresh: Date | null = null;

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly adminService: AdminService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService,
    private readonly moderationService: ModerationService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = params.get('q') ?? '';
        if (nextQuery !== this.searchControl.value) {
          this.searchControl.setValue(nextQuery, { emitEvent: false });
          this.ensureSelectedReport();
        }
      })
    );

    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const queue = data['queue'] as FlaggedContentReview[] | null | undefined;
        if (queue) {
          this.applyQueue(queue);
          return;
        }

        this.refresh();
      })
    );

    this.subscriptions.add(
      this.autoRefresh.every().subscribe(() => {
        if (!this.isLoading && !this.isReviewing) {
          this.refresh(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(silent = false): void {
    if (!silent) {
      this.errorMessage = '';
      this.isLoading = true;
    }

    const queueFilter = this.queueFilterControl.value === 'All' ? undefined : this.queueFilterControl.value;
    this.moderationService.getFlaggedContent(100, queueFilter)
      .pipe(finalize(() => {
        if (!silent) {
          this.isLoading = false;
        }
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (items) => {
          this.applyQueue(items);
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load moderation queue right now.';
          }
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: query || null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  clearSearch(): void {
    if (!this.searchControl.value.trim()) {
      return;
    }

    this.searchControl.setValue('');
    this.submitSearch();
  }

  selectReport(report: FlaggedContentReview): void {
    this.selectedModerationResultId = report.moderationResultId;
    this.actionMessage = '';
  }

  openReportDetails(report: FlaggedContentReview, event?: MouseEvent): void {
    event?.stopPropagation();
    this.selectReport(report);

    if (typeof location !== 'undefined') {
      location.hash = 'moderation-detail';
    }
  }

  reviewReport(report: FlaggedContentReview, action: ModerationReviewAction, label: string): void {
    if (this.isReviewing) {
      return;
    }

    if ((action === 'Freeze' || action === 'Escalate') && !this.hasReviewNote) {
      this.errorMessage = 'Add a moderator note before freezing an account or escalating a case.';
      return;
    }

    this.selectedModerationResultId = report.moderationResultId;
    this.isReviewing = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.adminService.reviewModerationResult(report.moderationResultId, {
      action,
      reason: this.noteControl.value.trim() || null
    })
      .pipe(finalize(() => {
        this.isReviewing = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: () => {
          this.actionMessage = `${label} for ${report.userDisplayName}.`;
          this.noteControl.setValue('');
          this.refresh();
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to save this moderation decision.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  reviewSelected(action: ModerationReviewAction, label: string): void {
    const report = this.selectedReport;
    if (!report) {
      return;
    }

    this.reviewReport(report, action, label);
  }

  openUserProfile(report = this.selectedReport): void {
    if (!report) {
      return;
    }

    void this.router.navigate(['/admin/users', report.userId], {
      queryParamsHandling: 'preserve'
    });
  }

  get filteredFlaggedContent(): FlaggedContentReview[] {
    const search = this.searchControl.value.trim().toLowerCase();

    return this.flaggedContent.filter((item) => {
      if (!search) {
        return true;
      }

      return [
        item.userDisplayName,
        item.userEmail,
        item.contentType,
        item.content,
        item.reason ?? '',
        item.action,
        item.reviewAction ?? '',
        item.reviewActionLabel ?? '',
        item.reviewNote ?? '',
        ...item.flags
      ].join(' ').toLowerCase().includes(search);
    });
  }

  get selectedReport(): FlaggedContentReview | null {
    return this.flaggedContent.find((item) => item.moderationResultId === this.selectedModerationResultId)
      ?? this.filteredFlaggedContent[0]
      ?? null;
  }

  get searchQuery(): string {
    return this.searchControl.value.trim();
  }

  get hasReviewNote(): boolean {
    return this.noteControl.value.trim().length > 0;
  }

  getContentPreview(item: FlaggedContentReview): string {
    return item.content.length > 160 ? `${item.content.slice(0, 157)}...` : item.content;
  }

  getContentTypeLabel(contentType: string): string {
    return contentType.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  getRiskLabel(score: number): string {
    const percentage = this.toRiskPercentage(score);

    if (percentage >= 80) {
      return 'High';
    }

    if (percentage >= 50) {
      return 'Medium';
    }

    return 'Low';
  }

  getRiskPercentage(score: number): number {
    return Math.round(this.toRiskPercentage(score));
  }

  getReviewStatusLabel(item: FlaggedContentReview): string {
    if (item.reviewActionLabel) {
      return item.reviewActionLabel;
    }

    if (item.isEscalated) {
      return 'Escalated';
    }

    return 'Pending review';
  }

  getReviewStatusClass(item: FlaggedContentReview): string {
    const action = item.reviewAction?.toLowerCase();
    if (action === 'freeze') {
      return 'danger';
    }

    if (action === 'warn' || action === 'escalate') {
      return 'warning';
    }

    if (action === 'dismiss') {
      return 'success';
    }

    return item.isEscalated ? 'warning' : 'pending';
  }

  getReviewStatusIcon(item: FlaggedContentReview): string {
    const action = item.reviewAction?.toLowerCase();
    if (action === 'freeze') {
      return 'lock';
    }

    if (action === 'warn') {
      return 'warning';
    }

    if (action === 'dismiss') {
      return 'check';
    }

    if (action === 'escalate' || item.isEscalated) {
      return 'arrow-up';
    }

    return 'clock';
  }

  getContentActionIcon(item: FlaggedContentReview): string {
    return item.action === 'Block' ? 'ban' : 'flag';
  }

  trackByReportId(_: number, item: FlaggedContentReview): string {
    return item.moderationResultId;
  }

  private toRiskPercentage(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }

    return score <= 1 ? score * 100 : score;
  }

  private applyQueue(items: FlaggedContentReview[]): void {
    this.flaggedContent = items;
    this.lastRefresh = new Date();
    this.errorMessage = '';
    this.ensureSelectedReport();
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private ensureSelectedReport(): void {
    if (!this.flaggedContent.length) {
      this.selectedModerationResultId = '';
      return;
    }

    if (
      !this.selectedModerationResultId ||
      !this.filteredFlaggedContent.some((item) => item.moderationResultId === this.selectedModerationResultId)
    ) {
      this.selectedModerationResultId = this.filteredFlaggedContent[0]?.moderationResultId
        ?? this.flaggedContent[0]?.moderationResultId
        ?? '';
    }
  }
}
