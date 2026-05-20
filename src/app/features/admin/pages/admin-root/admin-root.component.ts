import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PERMISSIONS } from '../../../../core/permissions';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-admin-root',
  standalone: false,
  templateUrl: './admin-root.component.html',
  styleUrls: ['./admin-root.component.scss']
})
export class AdminRootComponent implements OnInit, OnDestroy {
  @ViewChild('adminSearchInput') private adminSearchInput?: ElementRef<HTMLInputElement>;

  readonly searchControl = new FormControl('', { nonNullable: true });
  isAccountMenuOpen = false;
  isMobileNavOpen = false;
  isSearchOpen = false;
  readonly permissions = PERMISSIONS;

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly authService: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.searchControl.setValue(this.route.snapshot.queryParamMap.get('q') ?? '', { emitEvent: false });

    this.subscriptions.add(
      this.route.queryParamMap.subscribe((params) => {
        const nextQuery = params.get('q') ?? '';
        if (nextQuery !== this.searchControl.value) {
          this.searchControl.setValue(nextQuery, { emitEvent: false });
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  currentUserName(): string {
    const user = this.authService.getCurrentUser();
    return user?.displayName || user?.userName || 'Admin';
  }

  currentUserRole(): string {
    return this.authService.getCurrentUser()?.role || 'Admin';
  }

  currentUserAvatarUrl(): string {
    return this.authService.getCurrentUserAvatarUrl();
  }

  can(permission: string): boolean {
    return this.authService.hasPermission(permission);
  }

  submitSearch(): void {
    const query = this.searchControl.value.trim();
    this.isSearchOpen = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: query || null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  clearSearch(): void {
    if (!this.searchControl.value.trim()) {
      return;
    }

    this.searchControl.setValue('');
    this.submitSearch();
  }

  logout(): void {
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.authService.logout();
    void this.router.navigate(['/auth']);
  }

  toggleAccountMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isMobileNavOpen = false;
    this.isSearchOpen = false;
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  closeAccountMenu(): void {
    this.isAccountMenuOpen = false;
  }

  onAccountMenuContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  toggleMobileNav(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isSearchOpen = false;
    this.isMobileNavOpen = !this.isMobileNavOpen;
  }

  closeMobileNav(): void {
    this.isMobileNavOpen = false;
  }

  toggleSearch(event: MouseEvent): void {
    event.stopPropagation();
    this.isAccountMenuOpen = false;
    this.isMobileNavOpen = false;
    this.isSearchOpen = !this.isSearchOpen;

    if (this.isSearchOpen && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        this.adminSearchInput?.nativeElement.focus();
      });
    }
  }

  onSearchContainerClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  get currentUserInitials(): string {
    const source = this.currentUserName();
    return source
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'A';
  }

  get currentUserStatus(): string {
    return this.authService.getCurrentUser()?.isFrozen ? 'Frozen' : 'Active';
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    this.closeAccountMenu();
    this.closeMobileNav();
    this.isSearchOpen = false;
  }
}
