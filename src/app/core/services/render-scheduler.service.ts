import { ChangeDetectorRef, Injectable, NgZone } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RenderSchedulerService {
  constructor(private readonly ngZone: NgZone) {}

  schedule(changeDetectorRef: ChangeDetectorRef): void {
    queueMicrotask(() => {
      this.ngZone.run(() => {
        try {
          changeDetectorRef.detectChanges();
        } catch (error) {
          if (!this.isDestroyedViewError(error)) {
            throw error;
          }
        }
      });
    });
  }

  private isDestroyedViewError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('NG0911') || message.toLowerCase().includes('destroyed');
  }
}
