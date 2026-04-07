import { Component } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';

type SidebarSection = {
  route: string;
  label: string;
  description: string;
  tips: string[];
  accent: string;
};

@Component({
  selector: 'app-user-dashboard',
  standalone: false,
  templateUrl: './user-dashboard.component.html',
  styleUrls: ['./user-dashboard.component.scss']
})
export class UserDashboardComponent {
  readonly currentUser$;
  readonly sections: SidebarSection[] = [
    {
      route: '/dashboard/feed',
      label: 'Feed',
      description: 'Your main home for posts and updates.',
      tips: ['Post', 'Read', 'Reply'],
      accent: 'Home'
    },
    {
      route: '/dashboard/requests',
      label: 'Network',
      description: 'Manage requests and discover people.',
      tips: ['Find', 'Invite', 'Review'],
      accent: 'People'
    },
    {
      route: '/dashboard/messenger',
      label: 'Messages',
      description: 'Open chats and reply faster.',
      tips: ['Search', 'Send', 'Follow up'],
      accent: 'Chat'
    },
    {
      route: '/dashboard/notifications',
      label: 'Alerts',
      description: 'Track activity and updates.',
      tips: ['Unread', 'Mentions', 'Actions'],
      accent: 'Alert'
    },
    {
      route: '/dashboard/profile',
      label: 'Profile',
      description: 'Keep your details clean and current.',
      tips: ['Name', 'Info', 'Save'],
      accent: 'Me'
    }
  ];

  readonly activeSection$;
  readonly showSidebar$;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    this.currentUser$ = this.authService.user$;
    this.activeSection$ = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.resolveActiveSection(this.router.url))
    );
    this.showSidebar$ = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
      map(() => !this.isWideContentRoute(this.router.url))
    );
  }

  initials(name: string | null | undefined): string {
    const source = name?.trim() || 'Member';
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'TS';
  }

  motivationalTitle(section: SidebarSection | null | undefined): string {
    return section ? `${section.label}` : 'Workspace';
  }

  private resolveActiveSection(url: string): SidebarSection {
    return this.sections.find((section) => url.startsWith(section.route)) ?? this.sections[0];
  }

  private isWideContentRoute(url: string): boolean {
    return url.startsWith('/dashboard/search') || url.startsWith('/dashboard/members/');
  }
}
