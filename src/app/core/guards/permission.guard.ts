import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean | UrlTree> {
    if (!this.auth.getToken()) {
      return of(this.router.createUrlTree(['/auth']));
    }

    const permissions = (route.data['permissions'] as string[] | undefined) ?? [];
    const requireAll = route.data['requireAllPermissions'] === true;

    return this.auth.syncCurrentUser().pipe(
      map((user) => {
        if (!user) {
          return this.router.createUrlTree(['/auth']);
        }

        const allowed = requireAll
          ? permissions.every((permission) => this.auth.hasPermission(permission, user))
          : this.auth.hasAnyPermission(permissions, user);

        return allowed ? true : this.router.parseUrl(this.auth.getDefaultRoute(user.role));
      })
    );
  }
}
