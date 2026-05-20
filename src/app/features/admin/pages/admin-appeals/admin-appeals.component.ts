import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl } from '@angular/forms';
import { Subscription, finalize } from 'rxjs';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { ModerationService } from '../../../moderation/data-access/moderation.service';
import { AppealReview, AppealStatusFilter } from '../../../moderation/models/moderation.model';

@Component({
  selector: 'app-admin-appeals',
  standalone: false,
  templateUrl: './admin-appeals.component.html',
  styleUrls: ['./admin-appeals.component.scss']
})
export class AdminAppealsComponent implements OnInit, OnDestroy {
  readonly statusFilterOptions: readonly AdminSelectOption[] = [
    { value: 'All', label: 'All' },
    { value: 'Open', label: 'Open' },
    { value: 'Accepted', label: 'Accepted' },
    { value: 'Rejected', label: 'Rejected' }
  ];
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly statusFilterControl = new FormControl<AppealStatusFilter>('All', { nonNullable: true });

  appeals: AppealReview[] = [];
  selectedAppealId = '';
  isLoading = false;
  isUpdating = false;
  errorMessage = '';
  actionMessage = '';
  lastRefresh: Date | null = null;

  private readonly subscriptions = new Subscription();

  constructor(
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
          this.ensureSelectedAppeal();
        }
      })
    );

    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const appeals = data['appeals'] as AppealReview[] | null | undefined;
        if (appeals) {
          this.applyAppeals(appeals);
          return;
        }

        this.refresh();
      })
    );

    this.subscriptions.add(
      this.autoRefresh.every().subscribe(() => {
        if (!this.isLoading && !this.isUpdating) {
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

    const status = this.statusFilterControl.value === 'All' ? undefined : this.statusFilterControl.value;
    this.moderationService.getAppeals(100, status)
      .pipe(finalize(() => {
        if (!silent) {
          this.isLoading = false;
        }
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (appeals) => {
          this.applyAppeals(appeals);
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load appeals right now.';
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

  selectAppeal(appeal: AppealReview): void {
    this.selectedAppealId = appeal.id;
    this.actionMessage = '';
  }

  updateAppealStatus(appeal: AppealReview, status: AppealReview['status']): void {
    if (this.isUpdating || appeal.status === status) {
      return;
    }

    this.isUpdating = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.moderationService.updateAppealStatus(appeal.id, { status })
      .pipe(finalize(() => {
        this.isUpdating = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (updatedAppeal) => {
          this.appeals = this.appeals.map((item) => item.id === updatedAppeal.id ? updatedAppeal : item);
          this.actionMessage = `Appeal ${status.toLowerCase()} for ${appeal.userDisplayName}.`;
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to update this appeal right now.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  openUserProfile(appeal = this.selectedAppeal): void {
    if (!appeal) {
      return;
    }

    void this.router.navigate(['/admin/users', appeal.userId], {
      queryParamsHandling: 'preserve'
    });
  }

  get filteredAppeals(): AppealReview[] {
    const search = this.searchControl.value.trim().toLowerCase();

    return this.appeals.filter((appeal) => {
      if (!search) {
        return true;
      }

      return [
        appeal.userDisplayName,
        appeal.userEmail,
        appeal.targetType,
        appeal.targetId,
        appeal.status,
        appeal.reason ?? ''
      ].join(' ').toLowerCase().includes(search);
    });
  }

  get selectedAppeal(): AppealReview | null {
    return this.appeals.find((appeal) => appeal.id === this.selectedAppealId)
      ?? this.filteredAppeals[0]
      ?? null;
  }

  get searchQuery(): string {
    return this.searchControl.value.trim();
  }

  getAppealTone(status: AppealReview['status']): 'open' | 'accepted' | 'rejected' {
    switch (status) {
      case 'Accepted':
        return 'accepted';
      case 'Rejected':
        return 'rejected';
      default:
        return 'open';
    }
  }

  formatOriginalAction(appeal: AppealReview): string {
    switch (appeal.targetType.toLowerCase()) {
      case 'freeze':
        return 'Account freeze';
      case 'warning':
        return 'Warning';
      case 'post':
        return 'Post moderation';
      default:
        return appeal.targetType;
    }
  }

  trackByAppealId(_: number, appeal: AppealReview): string {
    return appeal.id;
  }

  private applyAppeals(appeals: AppealReview[]): void {
    this.appeals = appeals;
    this.lastRefresh = new Date();
    this.errorMessage = '';
    this.ensureSelectedAppeal();
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private ensureSelectedAppeal(): void {
    if (!this.appeals.length) {
      this.selectedAppealId = '';
      return;
    }

    if (!this.selectedAppealId || !this.filteredAppeals.some((appeal) => appeal.id === this.selectedAppealId)) {
      this.selectedAppealId = this.filteredAppeals[0]?.id ?? this.appeals[0]?.id ?? '';
    }
  }
}
