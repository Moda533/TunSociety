import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, catchError, finalize, forkJoin, of } from 'rxjs';
import { AutoRefreshService } from '../../../../core/services/auto-refresh.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { AdminService } from '../../data-access/admin.service';
import { AdminStatisticsOverviewInitialData } from '../../data-access/admin-route.resolvers';
import {
  AdminStatisticsOverview,
  AdminStatisticsRange,
  AdminStatisticsTrendPoint,
  AdminUserRiskSummary
} from '../../models/admin.model';

type StatisticsMetricKey =
  | 'users'
  | 'flagged'
  | 'blocked'
  | 'appealsSubmitted'
  | 'appealsResolved'
  | 'eventEvaluations';

interface StatisticsMetricDefinition {
  key: StatisticsMetricKey;
  label: string;
  color: string;
}

interface StatisticsChartPoint {
  x: number;
  y: number;
}

interface StatisticsChartSeries extends StatisticsMetricDefinition {
  areaPath: string;
  path: string;
  total: number;
}

interface StatisticsColumnBar extends StatisticsMetricDefinition {
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StatisticsColumnGroup {
  label: string;
  bars: StatisticsColumnBar[];
}

interface RiskBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

interface HistogramBar extends RiskBucket {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AdminFocusCard {
  label: string;
  value: number;
  description: string;
  route: string;
  tone: 'success' | 'warning' | 'danger';
}

@Component({
  selector: 'app-admin-statistics-overview',
  standalone: false,
  templateUrl: './admin-statistics-overview.component.html',
  styleUrls: ['./admin-statistics-overview.component.scss']
})
export class AdminStatisticsOverviewComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChildren('chartPanel') private chartPanels?: QueryList<ElementRef<HTMLElement>>;

  readonly ranges: readonly { value: AdminStatisticsRange; label: string }[] = [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' }
  ];

  readonly metricDefinitions: readonly StatisticsMetricDefinition[] = [
    { key: 'users', label: 'Users growth', color: '#2563eb' },
    { key: 'flagged', label: 'Flagged content', color: '#d97706' },
    { key: 'blocked', label: 'Blocked / frozen', color: '#dc2626' },
    { key: 'appealsSubmitted', label: 'Appeals submitted', color: '#7c3aed' },
    { key: 'appealsResolved', label: 'Appeals resolved', color: '#059669' },
    { key: 'eventEvaluations', label: 'Event evaluations', color: '#0891b2' }
  ];
  readonly lineMetricDefinitions: readonly StatisticsMetricDefinition[] = [
    { key: 'users', label: 'New users', color: '#2563eb' },
    { key: 'appealsSubmitted', label: 'Appeals submitted', color: '#7c3aed' },
    { key: 'appealsResolved', label: 'Appeals resolved', color: '#059669' },
    { key: 'eventEvaluations', label: 'Event evaluations', color: '#0891b2' }
  ];
  readonly columnMetricDefinitions: readonly StatisticsMetricDefinition[] = [
    { key: 'flagged', label: 'Flagged', color: '#d97706' },
    { key: 'blocked', label: 'Blocked / frozen', color: '#dc2626' },
    { key: 'appealsSubmitted', label: 'Appeals', color: '#7c3aed' },
    { key: 'eventEvaluations', label: 'Event evals', color: '#0891b2' }
  ];

  readonly chartWidth = 860;
  readonly chartHeight = 280;
  readonly compactChartWidth = 520;
  readonly compactChartHeight = 250;
  readonly chartPadding = {
    top: 18,
    right: 22,
    bottom: 34,
    left: 44
  };

  selectedRange: AdminStatisticsRange = '30d';
  overview: AdminStatisticsOverview | null = null;
  riskUsers: AdminUserRiskSummary[] = [];
  isLoading = false;
  errorMessage = '';
  lastUpdated: Date | null = null;

  private readonly subscriptions = new Subscription();
  private chartObserver?: IntersectionObserver;
  private readonly observedChartPanels = new WeakSet<HTMLElement>();

  constructor(
    private readonly adminService: AdminService,
    private readonly autoRefresh: AutoRefreshService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        const initialData = data['initialData'] as AdminStatisticsOverviewInitialData | null | undefined;
        if (initialData) {
          this.applyOverview(initialData.overview, initialData.riskUsers);
          return;
        }

        this.loadOverview();
      })
    );

    this.subscriptions.add(
      this.autoRefresh.every().subscribe(() => {
        if (!this.isLoading) {
          this.loadOverview(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.chartObserver?.disconnect();
  }

  ngAfterViewInit(): void {
    this.bindChartRevealObserver();

    if (this.chartPanels) {
      this.subscriptions.add(
        this.chartPanels.changes.subscribe(() => {
          this.bindChartRevealObserver();
        })
      );
    }
  }

  selectRange(range: AdminStatisticsRange): void {
    if (range === this.selectedRange && this.overview) {
      return;
    }

    this.selectedRange = range;
    this.loadOverview();
  }

  refresh(): void {
    this.loadOverview();
  }

  get selectedRangeLabel(): string {
    return this.ranges.find((range) => range.value === this.selectedRange)?.label ?? 'Selected range';
  }

  get summaryCards(): readonly { label: string; value: number; description: string; tone: string; icon: string }[] {
    const summary = this.overview?.summary;

    if (!summary) {
      return [];
    }

    return [
      {
        label: 'Total Users',
        value: summary.totalUsers,
        description: 'Registered accounts',
        tone: 'neutral',
        icon: 'U'
      },
      {
        label: 'Active Users',
        value: summary.activeUsers,
        description: `Activity in ${this.selectedRangeLabel.toLowerCase()}`,
        tone: 'success',
        icon: 'A'
      },
      {
        label: 'Flagged Content',
        value: summary.flaggedContent,
        description: 'Moderation results requiring attention',
        tone: 'warning',
        icon: 'F'
      },
      {
        label: 'Blocked / Frozen Users',
        value: summary.blockedUsers,
        description: 'Users affected by blocking or freeze actions',
        tone: 'danger',
        icon: 'B'
      },
      {
        label: 'Pending Appeals',
        value: summary.pendingAppeals,
        description: 'Open appeal requests',
        tone: 'info',
        icon: 'P'
      },
      {
        label: 'Resolved Appeals',
        value: summary.resolvedAppeals,
        description: 'Appeals closed in this range',
        tone: 'success',
        icon: 'R'
      },
      {
        label: 'Unassigned Members',
        value: summary.unassignedMembers,
        description: 'Users waiting for department assignment',
        tone: summary.unassignedMembers > 0 ? 'warning' : 'success',
        icon: 'D'
      },
      {
        label: 'Avg Event Rating',
        value: summary.averageEventRating ?? 0,
        description: `${summary.eventEvaluationCount} event evaluation${summary.eventEvaluationCount === 1 ? '' : 's'}`,
        tone: 'info',
        icon: 'E'
      },
      {
        label: 'Event Attendance',
        value: summary.eventAttendanceCount,
        description: 'Members marked as going',
        tone: 'success',
        icon: 'G'
      },
      {
        label: 'Event Engagement',
        value: summary.eventEngagement,
        description: 'Participation, comments, and ratings',
        tone: 'neutral',
        icon: 'V'
      }
    ];
  }

  get focusCards(): readonly AdminFocusCard[] {
    const summary = this.overview?.summary;

    if (!summary) {
      return [];
    }

    return [
      {
        label: 'Review queue',
        value: summary.flaggedContent,
        description: summary.flaggedContent > 0
          ? 'Start with flagged and blocked content before it becomes stale.'
          : 'No flagged content in this range.',
        route: '/admin/moderation',
        tone: summary.flaggedContent > 0 ? 'warning' : 'success'
      },
      {
        label: 'Open appeals',
        value: summary.pendingAppeals,
        description: summary.pendingAppeals > 0
          ? 'Resolve appeals before applying more account restrictions.'
          : 'No pending appeals need a decision.',
        route: '/admin/appeals',
        tone: summary.pendingAppeals > 0 ? 'warning' : 'success'
      },
      {
        label: 'Event evaluations',
        value: summary.eventEvaluationCount,
        description: summary.eventEvaluationCount > 0
          ? `Average rating is ${summary.averageEventRating ?? 0}. Review written feedback.`
          : 'No event ratings in this range yet.',
        route: '/admin/event-evaluations',
        tone: summary.eventEvaluationCount > 0 ? 'success' : 'warning'
      },
      {
        label: 'Account risk',
        value: summary.blockedUsers,
        description: summary.blockedUsers > 0
          ? 'Check frozen or blocked accounts against warning history.'
          : 'No blocked or frozen users in this range.',
        route: '/admin',
        tone: summary.blockedUsers > 0 ? 'danger' : 'success'
      }
    ];
  }

  get hasTrendData(): boolean {
    return (this.overview?.trends ?? []).some((point) =>
      this.metricDefinitions.some((metric) => this.trendValue(point, metric.key) > 0)
    );
  }

  get lineMaxTrendValue(): number {
    return Math.max(
      1,
      ...(this.overview?.trends ?? []).flatMap((point) =>
        this.lineMetricDefinitions.map((metric) => this.trendValue(point, metric.key))
      )
    );
  }

  get columnMaxValue(): number {
    return Math.max(
      1,
      ...(this.overview?.trends ?? []).flatMap((point) =>
        this.columnMetricDefinitions.map((metric) => this.trendValue(point, metric.key))
      )
    );
  }

  get riskMaxBucketValue(): number {
    return Math.max(1, ...this.riskBuckets.map((bucket) => bucket.count));
  }

  get lineYAxisTicks(): number[] {
    return this.buildTicks(this.lineMaxTrendValue);
  }

  get columnYAxisTicks(): number[] {
    return this.buildTicks(this.columnMaxValue);
  }

  get histogramYAxisTicks(): number[] {
    return this.buildTicks(this.riskMaxBucketValue);
  }

  get lineXAxisLabels(): readonly { x: number; label: string }[] {
    const trends = this.overview?.trends ?? [];

    if (!trends.length) {
      return [];
    }

    const maxLabels = this.selectedRange === '90d' ? 7 : this.selectedRange === '30d' ? 6 : trends.length;
    const interval = Math.max(1, Math.ceil(trends.length / maxLabels));

    return trends
      .map((point, index) => ({ point, index }))
      .filter(({ index }) => index === 0 || index === trends.length - 1 || index % interval === 0)
      .map(({ point, index }) => ({
        x: this.xForIndex(index, trends.length),
        label: this.formatDateLabel(point.date)
      }));
  }

  get compactXAxisLabels(): readonly { x: number; label: string }[] {
    const trends = this.overview?.trends ?? [];

    if (!trends.length) {
      return [];
    }

    const maxLabels = this.selectedRange === '90d' ? 5 : this.selectedRange === '30d' ? 4 : trends.length;
    const interval = Math.max(1, Math.ceil(trends.length / maxLabels));

    return trends
      .map((point, index) => ({ point, index }))
      .filter(({ index }) => index === 0 || index === trends.length - 1 || index % interval === 0)
      .map(({ point, index }) => ({
        x: this.compactGroupCenterX(index, trends.length),
        label: this.formatDateLabel(point.date)
      }));
  }

  get lineChartSeries(): StatisticsChartSeries[] {
    const trends = this.overview?.trends ?? [];

    return this.lineMetricDefinitions.map((metric) => {
      const values = trends.map((point) => this.trendValue(point, metric.key));
      const points = values.map((value, index) => this.pointFor(value, index, trends.length, this.lineMaxTrendValue));

      return {
        ...metric,
        areaPath: this.buildAreaPath(points),
        path: this.buildSmoothPath(points),
        total: values.reduce((sum, value) => sum + value, 0)
      };
    });
  }

  get columnGroups(): StatisticsColumnGroup[] {
    const trends = this.overview?.trends ?? [];
    const innerWidth = this.compactChartWidth - this.chartPadding.left - this.chartPadding.right;
    const groupWidth = trends.length ? innerWidth / trends.length : innerWidth;
    const gap = 2;
    const availableBarWidth = Math.max(2, (groupWidth - 8) / this.columnMetricDefinitions.length - gap);
    const barWidth = Math.max(2, Math.min(16, availableBarWidth));

    return trends.map((point, index) => {
      const groupStart = this.chartPadding.left + index * groupWidth;
      const barsWidth = this.columnMetricDefinitions.length * barWidth + (this.columnMetricDefinitions.length - 1) * gap;
      const firstX = groupStart + Math.max(2, (groupWidth - barsWidth) / 2);

      return {
        label: this.formatDateLabel(point.date),
        bars: this.columnMetricDefinitions.map((metric, metricIndex) => {
          const value = this.trendValue(point, metric.key);
          const y = this.yForCompactValue(value, this.columnMaxValue);
          return {
            ...metric,
            value,
            x: firstX + metricIndex * (barWidth + gap),
            y,
            width: barWidth,
            height: this.compactBaseline - y
          };
        })
      };
    });
  }

  get riskBuckets(): RiskBucket[] {
    const buckets: RiskBucket[] = [
      { label: '0-19', min: 0, max: 19, count: 0 },
      { label: '20-39', min: 20, max: 39, count: 0 },
      { label: '40-59', min: 40, max: 59, count: 0 },
      { label: '60-79', min: 60, max: 79, count: 0 },
      { label: '80-100', min: 80, max: 100, count: 0 }
    ];

    for (const user of this.riskUsers) {
      const score = Math.max(0, Math.min(100, user.riskScore ?? 0));
      const bucket = buckets.find((item) => score >= item.min && score <= item.max) ?? buckets[0];
      bucket.count += 1;
    }

    return buckets;
  }

  get histogramBars(): HistogramBar[] {
    const buckets = this.riskBuckets;
    const innerWidth = this.compactChartWidth - this.chartPadding.left - this.chartPadding.right;
    const groupWidth = buckets.length ? innerWidth / buckets.length : innerWidth;
    const gap = 8;
    const width = Math.max(18, groupWidth - gap);

    return buckets.map((bucket, index) => {
      const y = this.yForCompactValue(bucket.count, this.riskMaxBucketValue);
      return {
        ...bucket,
        x: this.chartPadding.left + index * groupWidth + gap / 2,
        y,
        width,
        height: this.compactBaseline - y
      };
    });
  }

  get compactBaseline(): number {
    return this.compactChartHeight - this.chartPadding.bottom;
  }

  loadOverview(silent = false): void {
    if (!silent) {
      this.errorMessage = '';
      this.isLoading = true;
    }

    forkJoin({
      overview: this.adminService.getStatisticsOverview(this.selectedRange),
      users: this.adminService.getUsers(0, 200).pipe(catchError(() => of([] as AdminUserRiskSummary[])))
    })
      .pipe(finalize(() => {
        if (!silent) {
          this.isLoading = false;
        }
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: ({ overview, users }) => {
          this.applyOverview(overview, users);
        },
        error: () => {
          if (!silent) {
            this.errorMessage = 'Unable to load statistics overview right now.';
          }
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  yForValue(value: number): number {
    const innerHeight = this.chartHeight - this.chartPadding.top - this.chartPadding.bottom;
    return this.chartPadding.top + innerHeight - (value / this.lineMaxTrendValue) * innerHeight;
  }

  yForCompactValue(value: number, maxValue: number): number {
    const innerHeight = this.compactChartHeight - this.chartPadding.top - this.chartPadding.bottom;
    return this.chartPadding.top + innerHeight - (value / Math.max(1, maxValue)) * innerHeight;
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat('en').format(value);
  }

  formatDateLabel(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
  }

  trackByRange(_: number, range: { value: AdminStatisticsRange }): AdminStatisticsRange {
    return range.value;
  }

  trackByMetric(_: number, metric: StatisticsChartSeries | StatisticsMetricDefinition | StatisticsColumnBar): StatisticsMetricKey {
    return metric.key;
  }

  trackByColumnGroup(_: number, group: StatisticsColumnGroup): string {
    return group.label;
  }

  trackByBucket(_: number, bucket: RiskBucket): string {
    return bucket.label;
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }

  private trendValue(point: AdminStatisticsTrendPoint, key: StatisticsMetricKey): number {
    return point[key] ?? 0;
  }

  private pointFor(value: number, index: number, total: number, maxValue: number): StatisticsChartPoint {
    return {
      x: this.xForIndex(index, total),
      y: this.yForLineValue(value, maxValue)
    };
  }

  private yForLineValue(value: number, maxValue: number): number {
    const innerHeight = this.chartHeight - this.chartPadding.top - this.chartPadding.bottom;
    return this.chartPadding.top + innerHeight - (value / Math.max(1, maxValue)) * innerHeight;
  }

  private xForIndex(index: number, total: number): number {
    const innerWidth = this.chartWidth - this.chartPadding.left - this.chartPadding.right;

    if (total <= 1) {
      return this.chartPadding.left + innerWidth / 2;
    }

    return this.chartPadding.left + index * (innerWidth / (total - 1));
  }

  private compactGroupCenterX(index: number, total: number): number {
    const innerWidth = this.compactChartWidth - this.chartPadding.left - this.chartPadding.right;

    if (total <= 1) {
      return this.chartPadding.left + innerWidth / 2;
    }

    const groupWidth = innerWidth / total;
    return this.chartPadding.left + index * groupWidth + groupWidth / 2;
  }

  private buildTicks(max: number): number[] {
    const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max].map((value) => Math.ceil(value));
    return Array.from(new Set(ticks));
  }

  private buildSmoothPath(points: readonly StatisticsChartPoint[]): string {
    if (!points.length) {
      return '';
    }

    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }

    const commands = [`M ${points[0].x} ${points[0].y}`];

    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (current.x + next.x) / 2;
      commands.push(`C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`);
    }

    return commands.join(' ');
  }

  private buildAreaPath(points: readonly StatisticsChartPoint[]): string {
    const linePath = this.buildSmoothPath(points);

    if (!linePath || !points.length) {
      return '';
    }

    const baseline = this.chartHeight - this.chartPadding.bottom;
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  }

  private applyOverview(overview: AdminStatisticsOverview, users: AdminUserRiskSummary[]): void {
    this.overview = overview;
    this.riskUsers = users;
    this.selectedRange = overview.range;
    this.lastUpdated = new Date();
    this.errorMessage = '';
    this.replayVisibleChartAnimations();
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private bindChartRevealObserver(): void {
    const panels = this.chartPanels?.toArray().map((item) => item.nativeElement) ?? [];

    if (!panels.length) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      for (const panel of panels) {
        this.revealChartPanel(panel);
      }
      return;
    }

    this.chartObserver ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.16) {
          this.revealChartPanel(entry.target as HTMLElement);
          this.chartObserver?.unobserve(entry.target);
        }
      }
    }, {
      root: null,
      rootMargin: '0px 0px -12% 0px',
      threshold: [0.16, 0.28, 0.4]
    });

    for (const panel of panels) {
      if (this.observedChartPanels.has(panel) || panel.classList.contains('chart-panel--visible')) {
        continue;
      }

      panel.classList.add('chart-panel--pending');
      this.observedChartPanels.add(panel);
      this.chartObserver.observe(panel);
    }
  }

  private revealChartPanel(panel: HTMLElement): void {
    panel.classList.remove('chart-panel--pending');
    panel.classList.add('chart-panel--visible');
  }

  private replayVisibleChartAnimations(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      const panels = this.chartPanels?.toArray().map((item) => item.nativeElement) ?? [];
      for (const panel of panels) {
        if (!panel.classList.contains('chart-panel--visible')) {
          continue;
        }

        panel.classList.remove('chart-panel--visible');
        void panel.offsetWidth;
        panel.classList.add('chart-panel--visible');
      }
    });
  }
}
