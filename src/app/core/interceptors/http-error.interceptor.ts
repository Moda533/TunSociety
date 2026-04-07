import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { HttpFeedbackService } from '../services/http-feedback.service';

@Injectable()
export class HttpErrorInterceptor implements HttpInterceptor {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
    private readonly feedback: HttpFeedbackService
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse) {
          this.handleHttpError(req, error);
        }

        return throwError(() => error);
      })
    );
  }

  private handleHttpError(req: HttpRequest<unknown>, error: HttpErrorResponse): void {
    if (error.status === 0) {
      this.feedback.show({
        kind: 'error',
        text: 'API is unreachable. Start backend on http://localhost:5000.'
      });
      return;
    }

    if (error.status === 401 && this.auth.getToken() && !this.isAuthRequest(req.url)) {
      this.auth.logout();
      this.feedback.show({
        kind: 'error',
        text: 'Your session expired. Please sign in again.'
      });
      this.router.navigate(['/auth']);
      return;
    }

    if (error.status === 403) {
      this.feedback.show({
        kind: 'error',
        text: 'You do not have permission to perform this action.'
      });
      return;
    }

    if (error.status === 423) {
      this.feedback.show({
        kind: 'error',
        text: this.extractMessage(error) || 'Your account is currently frozen.'
      });
    }
  }

  private isAuthRequest(url: string): boolean {
    return url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/oauth/');
  }

  private extractMessage(error: HttpErrorResponse): string {
    const payload = error.error;
    if (typeof payload === 'string' && payload.trim().length > 0) {
      return payload;
    }

    if (payload && typeof payload === 'object' && 'title' in payload) {
      const title = (payload as { title?: string }).title;
      if (typeof title === 'string') {
        return title;
      }
    }

    return '';
  }
}
