import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { AdminService } from '../../data-access/admin.service';
import {
  AdminEventEvaluationDashboard,
  AdminEventEvaluationEvent,
  AdminEventEvaluationFeedback
} from '../../models/admin.model';

@Component({
  selector: 'app-admin-event-evaluations',
  standalone: false,
  templateUrl: './admin-event-evaluations.component.html',
  styleUrls: ['./admin-event-evaluations.component.scss']
})
export class AdminEventEvaluationsComponent implements OnInit, OnDestroy {
  readonly ratingLevels = [5, 4, 3, 2, 1];

  dashboard: AdminEventEvaluationDashboard | null = null;
  isLoading = false;
  errorMessage = '';
  lastRefresh: Date | null = null;

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly adminService: AdminService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.subscriptions.add(
      this.adminService.getEventEvaluations()
        .pipe(finalize(() => {
          this.isLoading = false;
          this.renderScheduler.schedule(this.changeDetectorRef);
        }))
        .subscribe({
          next: (dashboard) => {
            this.dashboard = dashboard;
            this.lastRefresh = new Date();
            this.renderScheduler.schedule(this.changeDetectorRef);
          },
          error: () => {
            this.errorMessage = 'Unable to load event evaluation data right now.';
            this.renderScheduler.schedule(this.changeDetectorRef);
          }
        })
    );
  }

  get summaryCards(): readonly { label: string; value: string; description: string; tone: string }[] {
    const summary = this.dashboard?.summary;

    if (!summary) {
      return [];
    }

    return [
      {
        label: 'Average rating',
        value: summary.averageRating == null ? '0' : summary.averageRating.toFixed(1),
        description: `${summary.totalEvaluations} total rating${summary.totalEvaluations === 1 ? '' : 's'}`,
        tone: 'info'
      },
      {
        label: 'Rated events',
        value: String(summary.eventsWithEvaluations),
        description: 'Events that already received evaluations',
        tone: 'success'
      },
      {
        label: 'Needs attention',
        value: String(summary.pastEventsWithoutEvaluations),
        description: 'Past events without member ratings',
        tone: summary.pastEventsWithoutEvaluations > 0 ? 'warning' : 'success'
      },
      {
        label: 'Written feedback',
        value: String(summary.feedbackCount),
        description: 'Text comments attached to ratings',
        tone: 'neutral'
      }
    ];
  }

  get events(): AdminEventEvaluationEvent[] {
    return this.dashboard?.events ?? [];
  }

  get recentFeedback(): AdminEventEvaluationFeedback[] {
    return this.dashboard?.recentFeedback ?? [];
  }

  openEvent(event: AdminEventEvaluationEvent): void {
    void this.router.navigate(['/dashboard/events', event.eventId]);
  }

  ratingWidth(event: AdminEventEvaluationEvent, rating: number): string {
    const max = Math.max(1, ...event.ratingBreakdown);
    const value = event.ratingBreakdown[rating - 1] ?? 0;
    return `${Math.round((value / max) * 100)}%`;
  }

  ratingCount(event: AdminEventEvaluationEvent, rating: number): number {
    return event.ratingBreakdown[rating - 1] ?? 0;
  }

  statusFor(event: AdminEventEvaluationEvent): 'upcoming' | 'empty' | 'rated' {
    const startsAt = new Date(event.startsAtUtc).getTime();

    if (startsAt > Date.now()) {
      return 'upcoming';
    }

    return event.evaluationCount > 0 ? 'rated' : 'empty';
  }

  statusLabel(event: AdminEventEvaluationEvent): string {
    const status = this.statusFor(event);

    if (status === 'upcoming') {
      return 'Upcoming';
    }

    return status === 'rated' ? 'Rated' : 'Needs ratings';
  }

  trackByLabel(_: number, item: { label: string }): string {
    return item.label;
  }

  trackByEventId(_: number, event: AdminEventEvaluationEvent): string {
    return event.eventId;
  }

  trackByFeedbackId(_: number, feedback: AdminEventEvaluationFeedback): string {
    return feedback.id;
  }

  trackByRating(_: number, rating: number): number {
    return rating;
  }
}
