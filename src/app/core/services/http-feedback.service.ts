import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface HttpFeedbackMessage {
  kind: 'error' | 'info';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class HttpFeedbackService {
  private readonly messageSubject = new BehaviorSubject<HttpFeedbackMessage | null>(null);
  readonly message$ = this.messageSubject.asObservable();

  show(message: HttpFeedbackMessage) {
    this.messageSubject.next(message);
  }

  clear() {
    this.messageSubject.next(null);
  }
}
