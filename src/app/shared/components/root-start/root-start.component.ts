import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-root-start',
  standalone: false,
  templateUrl: './root-start.component.html',
  styleUrls: ['./root-start.component.scss']
})
export class RootStartComponent {
  constructor(private readonly authService: AuthService) {}

  get startRoute(): string {
    const user = this.authService.getCurrentUser();

    if (this.authService.isLoggedIn() && user?.role) {
      return this.authService.getDefaultRoute(user.role);
    }

    return '/about';
  }
}
