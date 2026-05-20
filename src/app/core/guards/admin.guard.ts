import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    if (!this.auth.getToken()) {
      return of(this.router.createUrlTree(['/auth']));
    }

    return this.auth.syncCurrentUser().pipe(
      map((user) => !user
        ? this.router.createUrlTree(['/auth'])
        : this.auth.canAccessAdminWorkspace(user)
          ? true
          : this.router.parseUrl(this.auth.getDefaultRoute(user.role)))
    );
  }
}
