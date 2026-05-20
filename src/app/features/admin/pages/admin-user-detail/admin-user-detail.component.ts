import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl } from '@angular/forms';
import { Observable, Subscription, catchError, finalize, forkJoin, of, switchMap } from 'rxjs';
import { AdminService } from '../../data-access/admin.service';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { AdminUserRiskSummary, BadgeTitle, Department } from '../../models/admin.model';
import { ModerationService } from '../../../moderation/data-access/moderation.service';
import { UserAvatarDirectoryService } from '../../../../core/services/user-avatar-directory.service';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { UserService } from '../../../user/data-access/user.service';
import { CommunityPost } from '../../../community/models/community.model';
import { AppealReview, FlaggedContentReview, FreezeReview, WarningReview } from '../../../moderation/models/moderation.model';
import { User } from '../../../user/models/user.model';
import { AdminUserDetailInitialData, buildFallbackRiskSummary } from '../../data-access/admin-route.resolvers';

type ProfileHistoryTab = 'posts' | 'moderation' | 'appeals';
type ModerationStatusTone = 'clean' | 'flagged' | 'blocked';
type StatTrendDirection = 'up' | 'down' | 'flat';
type StatSeverityTone = 'low' | 'medium' | 'high' | 'critical' | 'monitoring' | 'action';
type GuidanceTone = 'safe' | 'warning' | 'danger';

interface StatTrend {
  direction: StatTrendDirection;
  label: string;
}

interface UserStatCard {
  key: string;
  title: string;
  primaryLabel: string;
  primaryValue: string | number;
  periodLabel: string;
  trend: StatTrend;
  severityLabel: string;
  severityTone: StatSeverityTone;
  details: Array<{ label: string; value: string }>;
}

const DayMs = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-admin-user-detail',
  standalone: false,
  templateUrl: './admin-user-detail.component.html',
  styleUrls: ['./admin-user-detail.component.scss']
})
export class AdminUserDetailComponent implements OnInit, OnDestroy {
  readonly roleOptions: readonly AdminSelectOption[] = [
    { value: 'User', label: 'User' },
    { value: 'Moderator', label: 'Moderator' },
    { value: 'Admin', label: 'Admin' }
  ];
  readonly noteControl = new FormControl('', { nonNullable: true });
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly historyTabs: readonly { value: ProfileHistoryTab; label: string }[] = [
    { value: 'posts', label: 'Posts' },
    { value: 'moderation', label: 'Moderation history' },
    { value: 'appeals', label: 'Appeals' }
  ];

  user: User | null = null;
  riskSummary: AdminUserRiskSummary | null = null;
  departments: Department[] = [];
  badges: BadgeTitle[] = [];
  posts: CommunityPost[] = [];
  warnings: WarningReview[] = [];
  freezes: FreezeReview[] = [];
  appeals: AppealReview[] = [];
  flaggedContent: FlaggedContentReview[] = [];
  activeHistoryTab: ProfileHistoryTab = 'posts';
  isLoading = false;
  isUpdating = false;
  isMoreActionsOpen = false;
  isFreezeConfirmationOpen = false;
  errorMessage = '';
  actionMessage = '';
  lastRefresh: Date | null = null;

  private readonly subscriptions = new Subscription();
  private userId = '';

  constructor(
    private readonly adminService: AdminService,
    private readonly moderationService: ModerationService,
    private readonly avatarDirectory: UserAvatarDirectoryService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly userService: UserService
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.paramMap.subscribe((params) => {
        const nextUserId = params.get('userId') ?? params.get('id') ?? '';
        if (nextUserId && nextUserId !== this.userId) {
          this.userId = nextUserId;
        }
      })
    );

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = params.get('q') ?? '';
        if (nextQuery !== this.searchControl.value) {
          this.searchControl.setValue(nextQuery, { emitEvent: false });
        }
      })
    );

    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const initialData = data['initialData'] as AdminUserDetailInitialData | null | undefined;
        if (initialData) {
          this.applyUserDetail(initialData);
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

    this.loadMembershipOptions();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(silent = false): void {
    if (!this.userId) {
      return;
    }

    if (!silent) {
      this.errorMessage = '';
      this.isLoading = true;
    }

    this.userService.getById(this.userId)
      .pipe(
        switchMap((user) => forkJoin({
          user: of(user),
          riskSummary: this.adminService.getUserRiskSummary(this.userId).pipe(catchError(() => of(buildFallbackRiskSummary(user)))),
          posts: this.adminService.getUserPosts(this.userId, 12).pipe(catchError(() => of([]))),
          warnings: this.moderationService.getWarnings(20, this.userId).pipe(catchError(() => of([]))),
          freezes: this.moderationService.getFreezes(20, false, this.userId).pipe(catchError(() => of([]))),
          appeals: this.moderationService.getAppeals(20, undefined, this.userId).pipe(catchError(() => of([]))),
          flaggedContent: this.moderationService.getFlaggedContent(20, undefined, this.userId).pipe(catchError(() => of([])))
        })),
        finalize(() => {
          if (!silent) {
            this.isLoading = false;
          }
          this.renderScheduler.schedule(this.changeDetectorRef);
        })
      )
      .subscribe({
        next: ({ user, riskSummary, posts, warnings, freezes, appeals, flaggedContent }) => {
          this.applyUserDetail({ user, riskSummary, posts, warnings, freezes, appeals, flaggedContent });
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load this user right now.';
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

  updateUserRole(nextRole: string): void {
    if (!this.user || !nextRole || nextRole === this.user.role || this.isUpdating) {
      return;
    }

    this.isUpdating = true;
    this.actionMessage = '';

    this.userService.update(this.user.id, { role: nextRole }).subscribe({
      next: (updatedUser) => {
        this.user = updatedUser;
        this.avatarDirectory.seedUser(updatedUser);
        this.isUpdating = false;
        this.actionMessage = `Updated role to ${updatedUser.role}.`;
        this.renderScheduler.schedule(this.changeDetectorRef);
      },
      error: () => {
        this.isUpdating = false;
        this.errorMessage = 'Unable to update role right now.';
        this.renderScheduler.schedule(this.changeDetectorRef);
      }
    });
  }

  updateUserDepartment(nextDepartmentId: string): void {
    if (!this.user || this.isUpdating) {
      return;
    }

    const departmentId = nextDepartmentId || null;
    const badgeId = this.isBadgeAllowedForDepartment(this.user.badgeId, departmentId)
      ? this.user.badgeId
      : this.defaultBadgeId;

    this.updateUserMembership(departmentId, badgeId);
  }

  updateUserBadge(nextBadgeId: string): void {
    if (!this.user || this.isUpdating) {
      return;
    }

    this.updateUserMembership(this.user.departmentId, nextBadgeId || this.defaultBadgeId);
  }

  issueWarning(): void {
    if (!this.user || this.isUpdating) {
      return;
    }

    this.runUserAction(
      this.adminService.issueWarning(this.user.id, this.noteControl.value.trim() || null),
      'Warning issued.'
    );
  }

  requestFreezeConfirmation(): void {
    if (!this.user || this.isUpdating || this.isFrozen) {
      return;
    }

    if (!this.hasModerationNote) {
      this.errorMessage = 'A moderation note is required before freezing this account.';
      return;
    }

    this.isMoreActionsOpen = false;
    this.isFreezeConfirmationOpen = true;
  }

  closeFreezeConfirmation(): void {
    if (this.isUpdating) {
      return;
    }

    this.isFreezeConfirmationOpen = false;
  }

  confirmFreezeUser(): void {
    if (!this.user || this.isUpdating) {
      return;
    }

    if (!this.hasModerationNote) {
      this.errorMessage = 'A moderation note is required before freezing this account.';
      return;
    }

    this.runUserAction(
      this.adminService.freezeUser(this.user.id, this.noteControl.value.trim()),
      'Account frozen.'
    );
  }

  unfreezeUser(): void {
    if (!this.user || this.isUpdating) {
      return;
    }

    this.runUserAction(
      this.adminService.unfreezeUser(this.user.id),
      'Account unfrozen.'
    );
  }

  toggleMoreActions(): void {
    this.isMoreActionsOpen = !this.isMoreActionsOpen;
  }

  closeMoreActions(): void {
    this.isMoreActionsOpen = false;
  }

  openAuditTrail(): void {
    this.activeHistoryTab = 'moderation';
    this.isMoreActionsOpen = false;
    this.scrollToHistory();
  }

  openAppealHistory(): void {
    this.activeHistoryTab = 'appeals';
    this.isMoreActionsOpen = false;
    this.scrollToHistory();
  }

  openEscalationQueue(): void {
    if (!this.user) {
      return;
    }

    this.isMoreActionsOpen = false;
    void this.router.navigate(['/admin/moderation'], {
      queryParams: {
        q: this.user.email || this.user.displayName || this.user.userName
      },
      queryParamsHandling: 'merge'
    });
  }

  goBackToUsers(): void {
    void this.router.navigate(['/admin'], {
      queryParamsHandling: 'preserve'
    });
  }

  get searchQuery(): string {
    return this.searchControl.value.trim();
  }

  get userAvatarUrl(): string {
    return this.avatarDirectory.resolveAvatarUrl(this.user?.id, this.user?.gender);
  }

  get userInitials(): string {
    const source = this.user?.displayName || this.user?.userName || 'User';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'U';
  }

  get isFrozen(): boolean {
    return this.user?.isFrozen ?? false;
  }

  get hasModerationNote(): boolean {
    return this.noteControl.value.trim().length > 0;
  }

  get shouldShowEscalationAction(): boolean {
    return this.flaggedContent.some((item) => !item.isEscalated) ||
      this.moderationStatus.tone !== 'clean' ||
      (this.riskSummary?.openAppealCount ?? 0) > 0 ||
      (this.riskSummary?.riskLevel ?? '').toLowerCase() === 'high';
  }

  get freezeConfirmationSummary(): string {
    const name = this.user?.displayName || this.user?.userName || 'this user';
    return `Freeze ${name}? This will restrict the account and preserve the note in the moderation trail.`;
  }

  get shortUserId(): string {
    return this.user?.id ? `${this.user.id.slice(0, 8)}...` : 'Not set';
  }

  get departmentOptions(): readonly AdminSelectOption[] {
    return [
      { value: '', label: 'Unassigned' },
      ...this.departments.map((department) => ({
        value: department.id,
        label: department.name
      }))
    ];
  }

  get badgeOptions(): readonly AdminSelectOption[] {
    const user = this.user;
    return this.badges
      .filter((badge) => !badge.departmentId || !user?.departmentId || badge.departmentId === user.departmentId || badge.id === user.badgeId)
      .map((badge) => ({
        value: badge.id,
        label: badge.departmentName ? `${badge.name} (${badge.departmentName})` : badge.name
      }));
  }

  get defaultBadgeId(): string {
    return this.badges.find((badge) => badge.isDefault)?.id ?? this.user?.badgeId ?? '';
  }

  get riskDisplayLabel(): string {
    return this.riskSummary?.riskLevel || 'Low';
  }

  get riskDisplayScore(): number {
    return this.riskSummary?.riskScore ?? 0;
  }

  get riskTone(): 'low' | 'medium' | 'high' {
    const level = this.riskDisplayLabel.toLowerCase();
    if (level.includes('high')) {
      return 'high';
    }

    if (level.includes('medium')) {
      return 'medium';
    }

    return 'low';
  }

  get riskBadgeLabel(): string {
    return `${this.riskDisplayLabel.toUpperCase()} RISK \u00b7 ${this.riskDisplayScore}`;
  }

  get profileSignalLabel(): string {
    if (this.isFrozen || this.activeFreezes.length > 0) {
      return 'Frozen account';
    }

    if (this.riskTone === 'high') {
      return 'High-risk profile';
    }

    if (this.hasFlaggedSignals) {
      return 'Under investigation';
    }

    return 'No active case';
  }

  get behaviorPatternLabel(): string {
    return this.detectBehaviorPattern();
  }

  get decisionGuidance(): string {
    if (this.isFrozen || this.activeFreezes.length > 0) {
      return 'Account is frozen. Review recent flags and appeals before changing account status.';
    }

    if (this.riskTone === 'high') {
      const pattern = this.behaviorPatternLabel === 'No pattern detected'
        ? 'High-risk profile'
        : this.behaviorPatternLabel;
      return `${pattern}. Review evidence before warning or freezing.`;
    }

    if (this.hasFlaggedSignals) {
      return 'Review recent flags before taking account action.';
    }

    if ((this.riskSummary?.openAppealCount ?? 0) > 0) {
      return 'Open appeal needs review before escalation.';
    }

    return 'No urgent moderation action needed.';
  }

  get decisionGuidanceTone(): GuidanceTone {
    if (this.riskTone === 'high' || this.isFrozen || this.activeFreezes.length > 0) {
      return 'danger';
    }

    if (this.hasFlaggedSignals || (this.riskSummary?.openAppealCount ?? 0) > 0) {
      return 'warning';
    }

    return 'safe';
  }

  get hasFlaggedSignals(): boolean {
    return this.moderationStatus.tone !== 'clean';
  }

  get activeFreezes(): FreezeReview[] {
    return this.freezes.filter((freeze) => freeze.isActive);
  }

  get moderationStatus(): { label: string; tone: ModerationStatusTone } {
    if (this.isFrozen || this.activeFreezes.length > 0) {
      return { label: 'Blocked / Frozen', tone: 'blocked' };
    }

    const hasSignals =
      (this.riskSummary?.reportCount ?? 0) > 0 ||
      (this.riskSummary?.warningCount ?? 0) > 0 ||
      (this.riskSummary?.freezeCount ?? 0) > 0 ||
      this.flaggedContent.length > 0;

    return hasSignals
      ? { label: 'Flagged', tone: 'flagged' }
      : { label: 'Clean', tone: 'clean' };
  }

  get lastModerationActionLabel(): string {
    return this.riskSummary?.lastViolationLabel ?? 'No moderation action';
  }

  get lastModerationActionTime(): string {
    const timestamp = this.riskSummary?.lastViolationAtUtc;
    return timestamp ? this.formatRelativeTime(timestamp) : 'No history';
  }

  get recentFlagsCount(): number {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return this.flaggedContent.filter((item) => new Date(item.createdAtUtc).getTime() >= oneDayAgo).length;
  }

  get recentFlaggedContentPreview(): FlaggedContentReview[] {
    return [...this.flaggedContent]
      .sort((a, b) => new Date(b.createdAtUtc).getTime() - new Date(a.createdAtUtc).getTime())
      .slice(0, 3);
  }

  get moderationActionsCount(): number {
    return this.warnings.length + this.freezes.length;
  }

  get userStatCards(): UserStatCard[] {
    return [
      this.flagsStatCard,
      this.warningsStatCard,
      this.freezesStatCard,
      this.appealsStatCard
    ];
  }

  get flagsStatCard(): UserStatCard {
    const total = this.flaggedContent.length;
    const current = this.countSince(this.flaggedContent, (item) => item.createdAtUtc, DayMs);
    const previous = this.countBetween(this.flaggedContent, (item) => item.createdAtUtc, DayMs, DayMs * 2);
    const userReports = this.riskSummary?.reportCount ?? 0;
    const severity = this.getFlagsSeverity(total, current);

    return {
      key: 'flags',
      title: 'Flags',
      primaryLabel: 'Total flags',
      primaryValue: total,
      periodLabel: `Last 24h: ${current}`,
      trend: this.buildTrend(current, previous),
      severityLabel: severity.label,
      severityTone: severity.tone,
      details: [
        { label: 'Last incident', value: this.formatLastEvent(this.getLatestDate(this.flaggedContent, (item) => item.createdAtUtc)) },
        { label: 'Signals', value: `AI: ${total} - Reports: ${userReports}` }
      ]
    };
  }

  get warningsStatCard(): UserStatCard {
    const total = this.warnings.length;
    const current = this.countSince(this.warnings, (item) => item.issuedAtUtc, DayMs * 7);
    const previous = this.countBetween(this.warnings, (item) => item.issuedAtUtc, DayMs * 7, DayMs * 14);
    const severity = this.getWarningsSeverity(total, current);

    return {
      key: 'warnings',
      title: 'Warnings',
      primaryLabel: 'Total warnings',
      primaryValue: total,
      periodLabel: `Last 7 days: ${current}`,
      trend: this.buildTrend(current, previous),
      severityLabel: severity.label,
      severityTone: severity.tone,
      details: [
        { label: 'Last warning', value: this.formatLastEvent(this.getLatestDate(this.warnings, (item) => item.issuedAtUtc)) },
        { label: 'Pattern', value: this.behaviorPatternLabel }
      ]
    };
  }

  get freezesStatCard(): UserStatCard {
    const total = this.freezes.length;
    const current = this.countSince(this.freezes, (item) => item.startsAtUtc, DayMs * 30);
    const previous = this.countBetween(this.freezes, (item) => item.startsAtUtc, DayMs * 30, DayMs * 60);
    const severity = this.activeFreezes.length > 0
      ? { label: 'Action required', tone: 'action' as const }
      : total > 0
        ? { label: 'Monitoring', tone: 'monitoring' as const }
        : { label: 'Low', tone: 'low' as const };

    return {
      key: 'freezes',
      title: 'Freezes',
      primaryLabel: 'Total freezes',
      primaryValue: total,
      periodLabel: `Last 30 days: ${current}`,
      trend: this.buildTrend(current, previous),
      severityLabel: severity.label,
      severityTone: severity.tone,
      details: [
        { label: 'Active freeze', value: this.activeFreezes.length > 0 ? 'Yes' : 'No' },
        { label: 'Last freeze', value: this.formatLastEvent(this.getLatestDate(this.freezes, (item) => item.startsAtUtc)) }
      ]
    };
  }

  get appealsStatCard(): UserStatCard {
    const open = this.riskSummary?.openAppealCount ?? this.appeals.filter((appeal) => appeal.status === 'Open').length;
    const resolved = this.appeals.filter((appeal) => appeal.status !== 'Open').length;
    const current = this.countSince(this.appeals, (item) => item.createdAtUtc, DayMs * 30);
    const previous = this.countBetween(this.appeals, (item) => item.createdAtUtc, DayMs * 30, DayMs * 60);
    const severity = open > 0
      ? { label: 'Action required', tone: 'action' as const }
      : { label: 'No disputes', tone: 'low' as const };

    return {
      key: 'appeals',
      title: 'Appeals',
      primaryLabel: 'Open appeals',
      primaryValue: open,
      periodLabel: `Last 30 days: ${current}`,
      trend: this.buildTrend(current, previous),
      severityLabel: severity.label,
      severityTone: severity.tone,
      details: [
        { label: 'Resolved appeals', value: resolved.toString() },
        { label: 'Status', value: open > 0 ? `${open} active dispute${open === 1 ? '' : 's'}` : 'No active disputes' }
      ]
    };
  }

  getTabCount(tab: ProfileHistoryTab): number {
    switch (tab) {
      case 'posts':
        return this.posts.length;
      case 'moderation':
        return this.moderationActionsCount;
      case 'appeals':
        return this.appeals.length;
      default:
        return 0;
    }
  }

  get activeSearchPlaceholder(): string {
    return this.activeHistoryTab === 'posts'
      ? 'Search posts by title, content, visibility'
      : this.activeHistoryTab === 'moderation'
        ? 'Search warnings, freezes, reasons'
        : 'Search appeals by status, target, reason';
  }

  get filteredPosts(): CommunityPost[] {
    const search = this.searchQuery.toLowerCase();

    if (!search) {
      return this.posts;
    }

    return this.posts.filter((post) =>
      [post.title, post.content, post.visibility, post.authorName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  get filteredWarnings(): WarningReview[] {
    const search = this.searchQuery.toLowerCase();
    if (!search) {
      return this.warnings;
    }

    return this.warnings.filter((warning) =>
      [warning.reason, warning.issuedAtUtc].join(' ').toLowerCase().includes(search)
    );
  }

  get filteredFreezes(): FreezeReview[] {
    const search = this.searchQuery.toLowerCase();
    if (!search) {
      return this.freezes;
    }

    return this.freezes.filter((freeze) =>
      [freeze.reason, freeze.startsAtUtc, freeze.isActive ? 'active' : 'ended'].join(' ').toLowerCase().includes(search)
    );
  }

  get filteredAppeals(): AppealReview[] {
    const search = this.searchQuery.toLowerCase();
    if (!search) {
      return this.appeals;
    }

    return this.appeals.filter((appeal) =>
      [appeal.reason ?? '', appeal.targetType, appeal.targetId, appeal.status].join(' ').toLowerCase().includes(search)
    );
  }

  get filteredModerationActions(): Array<{ id: string; type: string; title: string; detail: string; timestamp: string; status?: string }> {
    const search = this.searchQuery.toLowerCase();
    const warningRows = this.warnings.map((warning) => ({
      id: warning.id,
      type: 'Warning',
      title: warning.reason,
      detail: warning.userEmail,
      timestamp: warning.issuedAtUtc,
      status: 'Warned'
    }));
    const freezeRows = this.freezes.map((freeze) => ({
      id: freeze.id,
      type: 'Freeze',
      title: freeze.reason,
      detail: freeze.isActive ? 'Active freeze' : 'Ended freeze',
      timestamp: freeze.startsAtUtc,
      status: freeze.isActive ? 'Active' : 'Ended'
    }));

    return [...warningRows, ...freezeRows]
      .filter((item) => {
        if (!search) {
          return true;
        }

        return [item.type, item.title, item.detail, item.status ?? '', item.timestamp]
          .join(' ')
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  formatPostVisibility(value: string): string {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  setHistoryTab(tab: ProfileHistoryTab): void {
    this.activeHistoryTab = tab;
  }

  getFlagPreview(item: FlaggedContentReview): string {
    return item.content.length > 96 ? `${item.content.slice(0, 93)}...` : item.content;
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

  formatRelativeTime(value: string): string {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) {
      return 'Unknown time';
    }

    const diffMs = Date.now() - timestamp;
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMinutes < 1) {
      return 'Just now';
    }

    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }

    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  }

  trackByPostId(_: number, post: CommunityPost): string {
    return post.id;
  }

  trackByWarningId(_: number, warning: WarningReview): string {
    return warning.id;
  }

  trackByFreezeId(_: number, freeze: FreezeReview): string {
    return freeze.id;
  }

  trackByAppealId(_: number, appeal: AppealReview): string {
    return appeal.id;
  }

  trackByModerationActionId(_: number, item: { id: string }): string {
    return item.id;
  }

  trackByFlagId(_: number, item: FlaggedContentReview): string {
    return item.moderationResultId;
  }

  trackByStatCardKey(_: number, item: UserStatCard): string {
    return item.key;
  }

  openModerationCase(item: FlaggedContentReview): void {
    void this.router.navigate(['/admin/moderation'], {
      queryParams: {
        q: item.contentId || item.userEmail || item.userDisplayName
      },
      queryParamsHandling: 'merge'
    });
  }

  private runUserAction(request: Observable<unknown>, successMessage: string): void {
    this.isUpdating = true;
    this.errorMessage = '';
    this.actionMessage = '';

    request.subscribe({
      next: () => {
        this.actionMessage = successMessage;
        this.noteControl.setValue('');
        this.isFreezeConfirmationOpen = false;
        this.isMoreActionsOpen = false;
        this.isUpdating = false;
        this.refresh();
        this.renderScheduler.schedule(this.changeDetectorRef);
      },
      error: () => {
        this.errorMessage = 'Unable to complete this action right now.';
        this.isUpdating = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      }
    });
  }

  private scrollToHistory(): void {
    if (typeof document === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector('.history-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }

  private applyUserDetail(data: AdminUserDetailInitialData): void {
    this.user = data.user;
    this.userId = data.user.id;
    this.riskSummary = data.riskSummary;
    this.posts = data.posts;
    this.warnings = data.warnings;
    this.freezes = data.freezes;
    this.appeals = data.appeals;
    this.flaggedContent = data.flaggedContent;
    this.avatarDirectory.seedUser(data.user);
    this.lastRefresh = new Date();
    this.errorMessage = '';
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private loadMembershipOptions(): void {
    this.subscriptions.add(
      forkJoin({
        departments: this.adminService.getDepartments().pipe(catchError(() => of([]))),
        badges: this.adminService.getBadges().pipe(catchError(() => of([])))
      }).subscribe(({ departments, badges }) => {
        this.departments = departments;
        this.badges = badges;
        this.renderScheduler.schedule(this.changeDetectorRef);
      })
    );
  }

  private updateUserMembership(departmentId: string | null, badgeId: string): void {
    const user = this.user;
    if (!user || !badgeId) {
      return;
    }

    this.isUpdating = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.adminService.updateUserMembership(user.id, { departmentId, badgeId }).subscribe({
      next: (updatedUser) => {
        this.user = updatedUser;
        this.avatarDirectory.seedUser(updatedUser);
        this.isUpdating = false;
        this.actionMessage = 'Club assignment updated.';
        this.refresh(true);
        this.renderScheduler.schedule(this.changeDetectorRef);
      },
      error: () => {
        this.isUpdating = false;
        this.errorMessage = 'Unable to update club assignment right now.';
        this.renderScheduler.schedule(this.changeDetectorRef);
      }
    });
  }

  private isBadgeAllowedForDepartment(badgeId: string, departmentId: string | null): boolean {
    const badge = this.badges.find((item) => item.id === badgeId);
    return !badge || !badge.departmentId || badge.departmentId === departmentId;
  }

  private buildTrend(current: number, previous: number): StatTrend {
    if (current === 0 && previous === 0) {
      return { direction: 'flat', label: 'Stable' };
    }

    if (previous === 0) {
      return { direction: current > 0 ? 'up' : 'flat', label: current > 0 ? '↑ +100%' : 'Stable' };
    }

    const change = Math.round(((current - previous) / previous) * 100);
    if (change === 0) {
      return { direction: 'flat', label: 'Stable' };
    }

    return {
      direction: change > 0 ? 'up' : 'down',
      label: change > 0 ? `↑ +${change}%` : `↓ ${change}%`
    };
  }

  private countSince<T>(items: readonly T[], getDate: (item: T) => string | null | undefined, windowMs: number): number {
    const now = Date.now();
    return items.filter((item) => {
      const timestamp = this.parseTimestamp(getDate(item));
      return timestamp !== null && timestamp >= now - windowMs && timestamp <= now;
    }).length;
  }

  private countBetween<T>(
    items: readonly T[],
    getDate: (item: T) => string | null | undefined,
    startOffsetMs: number,
    endOffsetMs: number
  ): number {
    const now = Date.now();
    return items.filter((item) => {
      const timestamp = this.parseTimestamp(getDate(item));
      return timestamp !== null && timestamp >= now - endOffsetMs && timestamp < now - startOffsetMs;
    }).length;
  }

  private getLatestDate<T>(items: readonly T[], getDate: (item: T) => string | null | undefined): string | null {
    const latest = items
      .map((item) => this.parseTimestamp(getDate(item)))
      .filter((timestamp): timestamp is number => timestamp !== null)
      .sort((a, b) => b - a)[0];

    return latest ? new Date(latest).toISOString() : null;
  }

  private parseTimestamp(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  private formatLastEvent(value: string | null): string {
    return value ? this.formatRelativeTime(value) : 'None';
  }

  private getFlagsSeverity(total: number, current: number): { label: string; tone: StatSeverityTone } {
    if (current >= 3 || total >= 10) {
      return { label: 'Critical', tone: 'critical' };
    }

    if (current >= 2 || total >= 6) {
      return { label: 'High', tone: 'high' };
    }

    if (current >= 1 || total >= 3) {
      return { label: 'Medium', tone: 'medium' };
    }

    return { label: 'Low', tone: 'low' };
  }

  private getWarningsSeverity(total: number, current: number): { label: string; tone: StatSeverityTone } {
    if (total >= 5 || current >= 3) {
      return { label: 'Critical', tone: 'critical' };
    }

    if (total >= 3 || current >= 2) {
      return { label: 'High', tone: 'high' };
    }

    if (total >= 1) {
      return { label: 'Medium', tone: 'medium' };
    }

    return { label: 'Low', tone: 'low' };
  }

  private detectBehaviorPattern(): string {
    const recentPostCount = this.countSince(this.posts, (item) => item.createdAtUtc, DayMs);
    const moderationText = [
      ...(this.riskSummary?.riskFactors ?? []),
      ...this.warnings.map((warning) => warning.reason),
      ...this.flaggedContent.map((item) => `${item.flags.join(' ')} ${item.reason ?? ''} ${item.content}`)
    ].join(' ').toLowerCase();

    if (/\b(hate|hateful|racism|racist|slur)\b/.test(moderationText)) {
      return 'Repeated hate speech';
    }

    if (/\b(spam|buy now|click here|limited offer|subscribe|promotion)\b/.test(moderationText)) {
      return 'Spam behavior detected';
    }

    if (recentPostCount >= 6) {
      return 'Rapid posting pattern';
    }

    if (/\b(harass|harassment|abuse|abusive|threat|insult|bully)\b/.test(moderationText)) {
      return 'Harassment pattern';
    }

    return this.riskSummary?.repeatViolationPattern ? 'Repeated policy violations' : 'No pattern detected';
  }
}
