import { ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { Subscription, finalize, forkJoin } from 'rxjs';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ModerationWorkspaceInitialData } from '../../data-access/moderation-route.resolvers';
import { ModerationService } from '../../data-access/moderation.service';
import {
  AppealStatusFilter,
  AppealReview,
  FlaggedContentReview,
  FreezeReview,
  ModerationResponse,
  ReviewActionFilter,
  WarningReview
} from '../../models/moderation.model';

@Component({
  selector: 'app-moderation',
  standalone: false,
  templateUrl: './moderation.component.html',
  styleUrls: ['./moderation.component.scss']
})
export class ModerationComponent implements OnInit, OnDestroy {
  @ViewChild('moderationSearchInput') private moderationSearchInput?: ElementRef<HTMLInputElement>;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly moderationService = inject(ModerationService);
  private readonly autoRefresh = inject(AutoRefreshService);
  private readonly zone = inject(NgZone);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly reviewTake = 25;
  readonly moderationSearchControl = new FormControl('', { nonNullable: true });
  isSubmitting = false;
  isLoadingReviews = false;
  isAccountMenuOpen = false;
  isMobileNavOpen = false;
  isSearchOpen = false;
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
  private readonly subscriptions = new Subscription();
  private readonly refreshIntervalMs = 5000;

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const initialData = data['initialData'] as ModerationWorkspaceInitialData | null | undefined;
        if (initialData) {
          this.applyReviewData(initialData);
          return;
        }

        this.loadReviewData();
      })
    );

    this.subscriptions.add(
      this.autoRefresh.every(this.refreshIntervalMs).subscribe(() => {
        if (this.canPollSilently()) {
          this.refreshReviews(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  currentUserName(): string {
    const user = this.authService.getCurrentUser();
    return user?.displayName || user?.userName || 'Moderator';
  }

  currentUserRole(): string {
    return this.authService.getCurrentUser()?.role || 'Moderator';
  }

  currentUserAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  canOpenAdmin(): boolean {
    return this.authService.canAccessAdminWorkspace();
  }

  submitWorkspaceSearch(): void {
    const query = this.moderationSearchControl.value.trim();
    this.isSearchOpen = false;

    void this.router.navigate(['/dashboard/search'], {
      queryParams: {
        query: query || null,
        scope: 'all'
      }
    });
  }

  clearWorkspaceSearch(): void {
    if (!this.moderationSearchControl.value.trim()) {
      return;
    }

    this.moderationSearchControl.setValue('');
    this.submitWorkspaceSearch();
  }

  logout(): void {
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.authService.logout();
    void this.router.navigate(['/auth']);
  }

  toggleAccountMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  closeAccountMenu(): void {
    this.isAccountMenuOpen = false;
  }

  onAccountMenuContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  toggleMobileNav(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isSearchOpen = false;
    this.isMobileNavOpen = !this.isMobileNavOpen;
  }

  closeMobileNav(): void {
    this.isMobileNavOpen = false;
  }

  toggleSearch(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = !this.isSearchOpen;

    if (this.isSearchOpen && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        this.moderationSearchInput?.nativeElement.focus();
      });
    }
  }

  onSearchContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  get currentUserInitials(): string {
    return this.currentUserName()
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'M';
  }

  get currentUserStatus(): string {
    return this.authService.getCurrentUser()?.isFrozen ? 'Frozen' : 'Active';
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.form.getRawValue();
    this.updateView(() => {
      this.isSubmitting = true;
      this.errorMessage = '';
      this.result = null;
    });

    this.moderationService.score(payload)
      .pipe(finalize(() => {
        this.updateView(() => {
          this.isSubmitting = false;
        });
      }))
      .subscribe({
        next: (response) => {
          this.updateView(() => {
            this.result = response;
          });
        },
        error: () => {
          this.updateView(() => {
            this.errorMessage = 'Unable to score the message right now.';
          });
        }
      });
  }

  refreshReviews(silent = false): void {
    this.loadReviewData(silent);
  }

  updateAppealStatus(appealId: string, status: AppealReview['status']): void {
    if (this.updatingAppealId) {
      return;
    }

    this.updateView(() => {
      this.updatingAppealId = appealId;
      this.reviewErrorMessage = '';
    });

    this.moderationService.updateAppealStatus(appealId, { status })
      .pipe(finalize(() => {
        this.updateView(() => {
          this.updatingAppealId = '';
        });
      }))
      .subscribe({
        next: () => {
          this.loadReviewData();
        },
        error: () => {
          this.updateView(() => {
            this.reviewErrorMessage = 'Unable to update appeal status right now.';
          });
        }
      });
  }

  formatContentType(contentType: string): string {
    return contentType.replace(/([a-z])([A-Z])/g, '$1 $2');
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

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  trackFlaggedContent(_: number, item: FlaggedContentReview): string {
    return item.moderationResultId;
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }

  private loadReviewData(silent = false): void {
    if (!silent) {
      this.updateView(() => {
        this.isLoadingReviews = true;
        this.reviewErrorMessage = '';
      });
    }

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
        this.updateView(() => {
          this.isLoadingReviews = false;
        });
      }))
      .subscribe({
        next: ({ flaggedContent, warnings, freezes, appeals }) => {
          this.applyReviewData({ flaggedContent, warnings, freezes, appeals });
        },
        error: () => {
          if (!silent) {
            this.updateView(() => {
              this.reviewErrorMessage = 'Unable to load moderation review data.';
            });
          }
        }
      });
  }

  private canPollSilently(): boolean {
    return !document.hidden && !this.isLoadingReviews && !this.isSubmitting && !this.updatingAppealId;
  }

  private updateView(action: () => void): void {
    this.zone.run(() => {
      action();
      this.changeDetectorRef.detectChanges();
    });
  }

  private applyReviewData(data: ModerationWorkspaceInitialData): void {
    this.updateView(() => {
      this.flaggedContent = data.flaggedContent;
      this.warnings = data.warnings;
      this.freezes = data.freezes;
      this.appeals = data.appeals;
      this.reviewErrorMessage = '';
    });
  }
}
