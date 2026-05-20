import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class GuestGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    const token = this.auth.getToken();
    const currentUser = this.auth.getCurrentUser();

    if (!token) {
      return of(true);
    }

    if (currentUser?.role) {
      return of(this.router.parseUrl(this.auth.getDefaultRoute(currentUser.role)));
    }

    return this.auth.syncCurrentUser().pipe(
      map((user) => user?.role
        ? this.router.parseUrl(this.auth.getDefaultRoute(user.role))
        : true)
    );
  }
}
