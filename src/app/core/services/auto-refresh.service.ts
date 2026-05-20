import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, fromEvent, merge, timer } from 'rxjs';
import { filter, map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AutoRefreshService {
  readonly defaultIntervalMs = 30000;

  constructor(private readonly router: Router) {}

  every(intervalMs = this.defaultIntervalMs): Observable<void> {
    if (typeof document === 'undefined') {
      return timer(0, intervalMs).pipe(map(() => void 0));
    }

    const browserTriggers: Observable<unknown>[] = [
      timer(0, intervalMs),
      this.router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)),
      fromEvent(document, 'visibilitychange').pipe(filter(() => !document.hidden))
    ];

    if (typeof window !== 'undefined') {
      browserTriggers.push(
        fromEvent(window, 'focus'),
        fromEvent(window, 'online')
      );
    }

    return merge(...browserTriggers).pipe(
      filter(() => !document.hidden),
      map(() => void 0)
    );
  }
}
