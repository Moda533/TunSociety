import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { CommunityService } from '../../../community/data-access/community.service';
import { CommunityEvent, EventParticipationStatus } from '../../../community/models/community.model';
import { ModerationFeedback } from '../../../moderation/models/moderation.model';

@Component({
  selector: 'app-event-detail-page',
  standalone: false,
  templateUrl: './event-detail-page.component.html',
  styleUrls: ['./event-detail-page.component.scss']
})
export class EventDetailPageComponent implements OnInit, OnDestroy {
  readonly commentControl = new FormControl('', { nonNullable: true });
  readonly feedbackControl = new FormControl('', { nonNullable: true });
  readonly ratingOptions = [1, 2, 3, 4, 5];

  event: CommunityEvent | null = null;
  selectedRating = 0;
  isLoading = false;
  isSubmittingComment = false;
  isSubmittingEvaluation = false;
  errorMessage = '';
  commentErrorMessage = '';
  evaluationErrorMessage = '';
  actionMessage = '';
  userId: string | null = null;
  likedEventIds = new Set<string>(this.loadLikedEventIds());

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly authService: AuthService,
    private readonly communityService: CommunityService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.subscriptions.add(
      this.authService.user$.subscribe((user) => {
        this.userId = user?.id ?? null;
        if (this.userId) {
          this.loadEvent();
        }
      })
    );

    this.subscriptions.add(
      this.route.paramMap.subscribe(() => {
        if (this.userId) {
          this.loadEvent();
        }
      })
    );

    if (!this.authService.getCurrentUser() && this.authService.getToken()) {
      this.authService.syncCurrentUser().subscribe();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get canModerateEvents(): boolean {
    return this.authService.canManageEvents();
  }

  get isPastEvent(): boolean {
    return this.event ? new Date(this.event.startsAtUtc).getTime() <= Date.now() : false;
  }

  setParticipation(status: EventParticipationStatus): void {
    const event = this.event;
    const userId = this.userId;
    if (!event || !userId || status === 'GoingInterested') {
      return;
    }

    this.communityService.updateEventParticipation(event.id, { userId, status }).subscribe({
      next: (updated) => {
        this.event = updated;
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveError(error, 'Unable to update event status.');
      }
    });
  }

  isGoing(): boolean {
    return this.event?.myStatus === 'Going' || this.event?.myStatus === 'GoingInterested';
  }

  isInterested(): boolean {
    return this.event?.myStatus === 'Interested' || this.event?.myStatus === 'GoingInterested';
  }

  isEventLiked(): boolean {
    const eventId = this.event?.id;
    return !!eventId && this.likedEventIds.has(eventId);
  }

  toggleEventLike(): void {
    const eventId = this.event?.id;
    if (!eventId) {
      return;
    }

    if (this.likedEventIds.has(eventId)) {
      this.likedEventIds.delete(eventId);
    } else {
      this.likedEventIds.add(eventId);
    }

    this.persistLikedEventIds();
  }

  focusDiscussion(): void {
    document.getElementById('event-discussion')?.scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    });

    window.setTimeout(() => {
      document.getElementById('event-comment-input')?.focus();
    }, 220);
  }

  shareEvent(): void {
    const event = this.event;
    if (!event) {
      return;
    }

    const targetUrl = this.router.serializeUrl(this.router.createUrlTree(['/dashboard/events', event.id]));
    const shareLink = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}${targetUrl}`
      : targetUrl;

    if (!navigator.clipboard?.writeText) {
      this.actionMessage = shareLink;
      return;
    }

    navigator.clipboard.writeText(shareLink)
      .then(() => {
        this.actionMessage = 'Event link copied.';
      })
      .catch(() => {
        this.actionMessage = shareLink;
      });
  }

  submitComment(): void {
    const event = this.event;
    const userId = this.userId;
    const content = this.commentControl.value.trim();
    if (!event || !userId || !content || this.isSubmittingComment) {
      return;
    }

    this.isSubmittingComment = true;
    this.commentErrorMessage = '';
    this.communityService.addEventComment(event.id, { userId, content }).subscribe({
      next: ({ data, moderation }) => {
        this.applyModerationAccountState(moderation);
        this.isSubmittingComment = false;
        if (!data) {
          this.commentErrorMessage = this.buildModerationMessage('Comment was not posted.', moderation);
          return;
        }

        this.event = data;
        this.commentControl.setValue('');
      },
      error: (error: unknown) => {
        this.commentErrorMessage = this.resolveError(error, 'Unable to add comment.');
        this.isSubmittingComment = false;
      }
    });
  }

  submitEvaluation(): void {
    const event = this.event;
    const userId = this.userId;
    if (!event || !userId || this.selectedRating < 1 || this.isSubmittingEvaluation) {
      return;
    }

    this.isSubmittingEvaluation = true;
    this.evaluationErrorMessage = '';
    this.communityService.evaluateEvent(event.id, {
      userId,
      rating: this.selectedRating,
      feedback: this.feedbackControl.value.trim() || null
    }).subscribe({
      next: (updated) => {
        this.event = updated;
        this.selectedRating = updated.myRating ?? this.selectedRating;
        this.feedbackControl.setValue('');
        this.isSubmittingEvaluation = false;
      },
      error: (error: unknown) => {
        this.evaluationErrorMessage = this.resolveError(error, 'Unable to save evaluation.');
        this.isSubmittingEvaluation = false;
      }
    });
  }

  deleteEvent(): void {
    const event = this.event;
    const userId = this.userId;
    if (!event || !userId || !this.canModerateEvents) {
      return;
    }

    this.communityService.deleteEvent(event.id, userId).subscribe({
      next: () => {
        void this.router.navigate(['/dashboard/feed']);
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveError(error, 'Unable to delete event.');
      }
    });
  }

  trackByParticipant(_: number, participant: { userId: string }): string {
    return participant.userId;
  }

  trackByComment(_: number, comment: { id: string }): string {
    return comment.id;
  }

  trackByRating(_: number, rating: number): number {
    return rating;
  }

  private loadEvent(): void {
    const eventId = this.route.snapshot.paramMap.get('eventId') ?? '';
    const userId = this.userId;
    if (!eventId || !userId) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.communityService.getEvent(eventId, userId).subscribe({
      next: (event) => {
        this.event = event;
        this.selectedRating = event.myRating ?? 0;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveError(error, 'Unable to load event.');
        this.isLoading = false;
      }
    });
  }

  private applyModerationAccountState(moderation: ModerationFeedback): void {
    if (moderation.accountFrozen) {
      this.authService.markCurrentUserFrozen();
    }
  }

  private buildModerationMessage(prefix: string, moderation: ModerationFeedback): string {
    const parts = [prefix];
    if (moderation.reason) {
      parts.push(moderation.reason);
    }

    if (moderation.warningCount > 0) {
      parts.push(`Warning ${moderation.warningCount} of 3.`);
    }

    if (moderation.accountFrozen) {
      parts.push('Your account is now frozen.');
    }

    return parts.join(' ').trim();
  }

  private resolveError(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'error' in error) {
      const payload = (error as { error?: unknown }).error;
      if (typeof payload === 'string' && payload.trim().length > 0) {
        return payload;
      }
    }

    return fallback;
  }

  private loadLikedEventIds(): string[] {
    try {
      const raw = localStorage.getItem('ts_liked_events');
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
    } catch {
      return [];
    }
  }

  private persistLikedEventIds(): void {
    try {
      localStorage.setItem('ts_liked_events', JSON.stringify(Array.from(this.likedEventIds)));
    } catch {
      // Keep the in-memory state if storage is unavailable.
    }
  }
}
