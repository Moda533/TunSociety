import { Component, HostListener, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

type SessionEntryPageId = 'about' | 'features' | 'policy' | 'contact';

interface SessionEntryCard {
  index: string;
  title: string;
  text: string;
}

interface SessionEntryPage {
  cards: SessionEntryCard[];
}

interface GuestCardPosition {
  x: number;
  y: number;
}

interface GuestCardDragState {
  index: number;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  velocityX: number;
  velocityY: number;
  card: HTMLElement;
  container: HTMLElement;
}

interface GuestCardSlideState {
  index: number;
  card: HTMLElement;
  container: HTMLElement;
  velocityX: number;
  velocityY: number;
  lastTime: number;
  startedAt: number;
  baseX: number;
  baseY: number;
  offsetX: number;
  offsetY: number;
  maxX: number;
  maxY: number;
}

@Component({
  selector: 'app-session-entry',
  standalone: false,
  templateUrl: './session-entry.component.html',
  styleUrls: ['./session-entry.component.scss']
})
export class SessionEntryComponent implements OnDestroy {
  isMobileNavOpen = false;
  draggingGuestCardIndex: number | null = null;
  slidingGuestCardIndex: number | null = null;
  private topGuestCardIndex = 0;
  private guestCardDrag: GuestCardDragState | null = null;
  private guestCardSlide: GuestCardSlideState | null = null;
  private guestCardSlideFrame = 0;
  guestCardPositions: GuestCardPosition[] = [
    { x: 2, y: 8 },
    { x: 70, y: 10 },
    { x: 8, y: 68 }
  ];

  private readonly pages: Record<SessionEntryPageId, SessionEntryPage> = {
    about: {
      cards: [
        {
          index: '01',
          title: 'Clear member profiles',
          text: 'Members use personal profiles so people know who they are talking to.'
        },
        {
          index: '02',
          title: 'Organized communication',
          text: 'Posts, comments, messages, and requests stay in one community space.'
        },
        {
          index: '03',
          title: 'Responsible supervision',
          text: 'Admins can review problems and take action when rules are broken.'
        }
      ]
    },
    features: {
      cards: [
        {
          index: '01',
          title: 'Community feed',
          text: 'Share news, read updates, comment, and react to community posts.'
        },
        {
          index: '02',
          title: 'Private messages',
          text: 'Contact other members directly for simple and private coordination.'
        },
        {
          index: '03',
          title: 'Friend requests',
          text: 'Choose who can connect with you and manage requests clearly.'
        }
      ]
    },
    policy: {
      cards: [
        {
          index: '01',
          title: 'Not allowed',
          text: 'Dangerous, hateful, insulting, or scam content can be blocked or reviewed.'
        },
        {
          index: '02',
          title: 'Warnings and freezes',
          text: 'Repeated or serious problems can lead to warnings or account freezes.'
        },
        {
          index: '03',
          title: 'Recorded decisions',
          text: 'Important admin actions are saved so they can be checked later.'
        }
      ]
    },
    contact: {
      cards: [
        {
          index: '01',
          title: 'Account help',
          text: 'Sign in to open your account, profile, messages, and notifications.'
        },
        {
          index: '02',
          title: 'Rules and safety',
          text: 'Read the policy page to understand what is allowed and not allowed.'
        },
        {
          index: '03',
          title: 'General information',
          text: 'Visit the About and Features pages to understand what TunSociety offers.'
        }
      ]
    }
  };

  constructor(
    private readonly router: Router,
    private readonly ngZone: NgZone
  ) {}

  ngOnDestroy(): void {
    this.stopGuestCardSlide(false);
  }

  get pageId(): SessionEntryPageId {
    return this.resolvePageId(this.router.url);
  }

  get page(): SessionEntryPage {
    return this.pages[this.pageId];
  }

  toggleMobileNav(event: MouseEvent): void {
    event.stopPropagation();
    this.isMobileNavOpen = !this.isMobileNavOpen;
  }

  closeMobileNav(): void {
    this.isMobileNavOpen = false;
  }

  trackByGuestCard(_: number, card: SessionEntryCard): string {
    return card.index;
  }

  getGuestCardLeft(index: number): string {
    return `${this.guestCardPositions[index]?.x ?? 0}%`;
  }

  getGuestCardTop(index: number): string {
    return `${this.guestCardPositions[index]?.y ?? 0}%`;
  }

  getGuestCardZIndex(index: number): number {
    if (this.draggingGuestCardIndex === index) {
      return 4;
    }

    return this.topGuestCardIndex === index ? 3 : 2;
  }

  startGuestCardDrag(index: number, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    if (window.matchMedia('(max-width: 980px)').matches) {
      return;
    }

    const card = event.currentTarget as HTMLElement | null;
    const container = card?.closest('.guest-floating-cards') as HTMLElement | null;
    if (!card || !container) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const cardRect = card.getBoundingClientRect();
    this.stopGuestCardSlide(true);
    this.guestCardDrag = {
      index,
      pointerId: event.pointerId,
      offsetX: event.clientX - cardRect.left,
      offsetY: event.clientY - cardRect.top,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
      card,
      container
    };
    this.draggingGuestCardIndex = index;
    this.topGuestCardIndex = index;
    card.setPointerCapture(event.pointerId);
    this.moveGuestCard(event);
  }

  @HostListener('document:pointermove', ['$event'])
  onGuestCardPointerMove(event: PointerEvent): void {
    this.moveGuestCard(event);
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  stopGuestCardDrag(event: PointerEvent): void {
    const drag = this.guestCardDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    this.moveGuestCard(event);

    if (drag.card.hasPointerCapture(event.pointerId)) {
      drag.card.releasePointerCapture(event.pointerId);
    }

    this.guestCardDrag = null;
    this.draggingGuestCardIndex = null;
    this.startGuestCardSlide(drag);
  }

  private resolvePageId(url: string): SessionEntryPageId {
    const path = url.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');

    if (path === 'about' || path === 'features' || path === 'policy' || path === 'contact') {
      return path;
    }

    return 'about';
  }

  private moveGuestCard(event: PointerEvent): void {
    const drag = this.guestCardDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const containerRect = drag.container.getBoundingClientRect();
    const cardRect = drag.card.getBoundingClientRect();
    const maxX = Math.max(0, containerRect.width - cardRect.width);
    const maxY = Math.max(0, containerRect.height - cardRect.height);
    const nextX = this.clamp(event.clientX - containerRect.left - drag.offsetX, 0, maxX);
    const nextY = this.clamp(event.clientY - containerRect.top - drag.offsetY, 0, maxY);
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime);
    const nextVelocityX = ((event.clientX - drag.lastX) / elapsed) * 1000;
    const nextVelocityY = ((event.clientY - drag.lastY) / elapsed) * 1000;

    drag.velocityX = drag.velocityX * 0.35 + nextVelocityX * 0.65;
    drag.velocityY = drag.velocityY * 0.35 + nextVelocityY * 0.65;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;

    this.setGuestCardPosition(drag.index, {
      x: containerRect.width > 0 ? (nextX / containerRect.width) * 100 : 0,
      y: containerRect.height > 0 ? (nextY / containerRect.height) * 100 : 0
    });
    this.resolveGuestCardCollisions(drag.index, drag.container);
  }

  private startGuestCardSlide(drag: GuestCardDragState): void {
    const movedX = drag.lastX - drag.startX;
    const movedY = drag.lastY - drag.startY;
    const movedDistance = Math.hypot(movedX, movedY);
    if (movedDistance <= 4 || window.matchMedia('(max-width: 980px)').matches) {
      return;
    }

    const directionX = movedX / movedDistance;
    const directionY = movedY / movedDistance;
    let velocityX = drag.velocityX;
    let velocityY = drag.velocityY;
    let speed = Math.hypot(velocityX, velocityY);
    const minimumReleaseSpeed = 860;

    if (speed < minimumReleaseSpeed) {
      velocityX = directionX * minimumReleaseSpeed;
      velocityY = directionY * minimumReleaseSpeed;
      speed = minimumReleaseSpeed;
    }

    if ((velocityX * directionX + velocityY * directionY) < 0) {
      velocityX = directionX * speed;
      velocityY = directionY * speed;
    }

    const containerRect = drag.container.getBoundingClientRect();
    const cardRect = drag.card.getBoundingClientRect();
    const current = this.guestCardPositions[drag.index] ?? { x: 0, y: 0 };
    const now = performance.now();
    this.stopGuestCardSlide(true);
    this.guestCardSlide = {
      index: drag.index,
      card: drag.card,
      container: drag.container,
      velocityX: this.clamp(velocityX, -2200, 2200),
      velocityY: this.clamp(velocityY, -2200, 2200),
      lastTime: now,
      startedAt: now,
      baseX: (current.x / 100) * containerRect.width,
      baseY: (current.y / 100) * containerRect.height,
      offsetX: 0,
      offsetY: 0,
      maxX: Math.max(0, containerRect.width - cardRect.width),
      maxY: Math.max(0, containerRect.height - cardRect.height)
    };
    this.slidingGuestCardIndex = drag.index;
    this.topGuestCardIndex = drag.index;
    this.scheduleGuestCardSlide();
  }

  private slideGuestCard(time: number): void {
    const slide = this.guestCardSlide;
    if (!slide) {
      return;
    }

    const elapsed = this.clamp(time - slide.lastTime, 1, 34);
    let nextX = slide.baseX + slide.offsetX + slide.velocityX * (elapsed / 1000);
    let nextY = slide.baseY + slide.offsetY + slide.velocityY * (elapsed / 1000);
    const bounce = 0.62;

    if (nextX <= 0 || nextX >= slide.maxX) {
      nextX = this.clamp(nextX, 0, slide.maxX);
      slide.velocityX = -slide.velocityX * bounce;
    }

    if (nextY <= 0 || nextY >= slide.maxY) {
      nextY = this.clamp(nextY, 0, slide.maxY);
      slide.velocityY = -slide.velocityY * bounce;
    }

    slide.offsetX = nextX - slide.baseX;
    slide.offsetY = nextY - slide.baseY;
    slide.card.style.transform = `translate3d(${slide.offsetX}px, ${slide.offsetY}px, 0) scale(1.01)`;

    const friction = Math.pow(0.972, elapsed / 16.67);
    slide.velocityX *= friction;
    slide.velocityY *= friction;
    slide.lastTime = time;

    if (Math.hypot(slide.velocityX, slide.velocityY) < 42 || time - slide.startedAt > 2600) {
      this.stopGuestCardSlide(true);
      return;
    }

    this.scheduleGuestCardSlide();
  }

  private scheduleGuestCardSlide(): void {
    this.ngZone.runOutsideAngular(() => {
      this.guestCardSlideFrame = requestAnimationFrame((nextTime) => this.slideGuestCard(nextTime));
    });
  }

  private stopGuestCardSlide(commitPosition: boolean): void {
    if (this.guestCardSlideFrame) {
      cancelAnimationFrame(this.guestCardSlideFrame);
      this.guestCardSlideFrame = 0;
    }

    const slide = this.guestCardSlide;
    if (slide) {
      const containerRect = slide.container.getBoundingClientRect();
      const finalX = this.clamp(slide.baseX + slide.offsetX, 0, slide.maxX);
      const finalY = this.clamp(slide.baseY + slide.offsetY, 0, slide.maxY);
      const finalPosition = {
        x: containerRect.width > 0 ? (finalX / containerRect.width) * 100 : 0,
        y: containerRect.height > 0 ? (finalY / containerRect.height) * 100 : 0
      };

      if (commitPosition) {
        slide.card.style.left = `${finalPosition.x}%`;
        slide.card.style.top = `${finalPosition.y}%`;
      }

      slide.card.style.transform = '';

      if (commitPosition) {
        this.ngZone.run(() => {
          this.setGuestCardPosition(slide.index, finalPosition);
          this.slidingGuestCardIndex = null;
        });
      } else {
        this.slidingGuestCardIndex = null;
      }
    } else {
      this.slidingGuestCardIndex = null;
    }

    this.guestCardSlide = null;
  }

  private resolveGuestCardCollisions(activeIndex: number, container: HTMLElement): void {
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.guest-feature-card'));
    const containerRect = container.getBoundingClientRect();
    const gap = 12;

    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < cards.length; index += 1) {
        if (index === activeIndex) {
          continue;
        }

        const activeRect = this.buildGuestCardRect(activeIndex, cards[activeIndex], containerRect);
        const targetRect = this.buildGuestCardRect(index, cards[index], containerRect);
        const overlapX = Math.min(activeRect.x + activeRect.width, targetRect.x + targetRect.width) -
          Math.max(activeRect.x, targetRect.x);
        const overlapY = Math.min(activeRect.y + activeRect.height, targetRect.y + targetRect.height) -
          Math.max(activeRect.y, targetRect.y);

        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        let nextX = targetRect.x;
        let nextY = targetRect.y;

        if (overlapX < overlapY) {
          const direction = activeRect.x + activeRect.width / 2 <= targetRect.x + targetRect.width / 2 ? 1 : -1;
          nextX += direction * (overlapX + gap);
        } else {
          const direction = activeRect.y + activeRect.height / 2 <= targetRect.y + targetRect.height / 2 ? 1 : -1;
          nextY += direction * (overlapY + gap);
        }

        const maxX = Math.max(0, containerRect.width - targetRect.width);
        const maxY = Math.max(0, containerRect.height - targetRect.height);
        this.setGuestCardPosition(index, {
          x: containerRect.width > 0 ? (this.clamp(nextX, 0, maxX) / containerRect.width) * 100 : 0,
          y: containerRect.height > 0 ? (this.clamp(nextY, 0, maxY) / containerRect.height) * 100 : 0
        });
      }
    }
  }

  private buildGuestCardRect(index: number, card: HTMLElement | undefined, containerRect: DOMRect): DOMRect {
    const cardRect = card?.getBoundingClientRect();
    const position = this.guestCardPositions[index] ?? { x: 0, y: 0 };

    return {
      x: (position.x / 100) * containerRect.width,
      y: (position.y / 100) * containerRect.height,
      width: cardRect?.width ?? 0,
      height: cardRect?.height ?? 0
    } as DOMRect;
  }

  private setGuestCardPosition(index: number, position: GuestCardPosition): void {
    this.guestCardPositions = this.guestCardPositions.map((item, itemIndex) =>
      itemIndex === index ? position : item
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
