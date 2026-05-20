import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { Subscription, finalize, forkJoin } from 'rxjs';
import { PERMISSIONS } from '../../../../core/permissions';
import { AuthService } from '../../../../core/services/auth.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { AdminService } from '../../data-access/admin.service';
import { BadgeTitle, Department } from '../../models/admin.model';

@Component({
  selector: 'app-admin-badges',
  standalone: false,
  templateUrl: './admin-badges.component.html',
  styleUrls: ['./admin-badges.component.scss']
})
export class AdminBadgesComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  readonly badgeForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    departmentId: ['']
  });
  readonly globalBadgeSearchControl = new FormControl('', { nonNullable: true });

  badges: BadgeTitle[] = [];
  departments: Department[] = [];
  editingBadgeId = '';
  isLoading = false;
  isSaving = false;
  isGlobalBadgesPopupOpen = false;
  errorMessage = '';
  actionMessage = '';

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService
  ) {}

  get canManageBadges(): boolean {
    return this.authService.hasPermission(PERMISSIONS.badgesManage);
  }

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refresh(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.subscriptions.add(
      forkJoin({
        badges: this.adminService.getBadges(),
        departments: this.adminService.getDepartments()
      }).pipe(finalize(() => {
        this.isLoading = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      })).subscribe({
        next: ({ badges, departments }) => {
          this.badges = badges;
          this.departments = departments;
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to load badges right now.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  startCreate(): void {
    this.editingBadgeId = '';
    this.badgeForm.reset({ name: '', departmentId: '' });
    this.errorMessage = '';
    this.actionMessage = '';
  }

  editBadge(badge: BadgeTitle): void {
    this.editingBadgeId = badge.id;
    this.badgeForm.reset({
      name: badge.name,
      departmentId: badge.departmentId ?? ''
    });
    this.errorMessage = '';
    this.actionMessage = '';
  }

  editGlobalBadge(badge: BadgeTitle): void {
    this.editBadge(badge);
    this.closeGlobalBadgesPopup();
  }

  openGlobalBadgesPopup(): void {
    this.globalBadgeSearchControl.setValue('', { emitEvent: false });
    this.isGlobalBadgesPopupOpen = true;
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  closeGlobalBadgesPopup(): void {
    this.isGlobalBadgesPopupOpen = false;
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  clearGlobalBadgeSearch(): void {
    if (!this.globalBadgeSearchControl.value.trim()) {
      return;
    }

    this.globalBadgeSearchControl.setValue('');
  }

  saveBadge(): void {
    if (this.badgeForm.invalid || this.isSaving) {
      this.badgeForm.markAllAsTouched();
      return;
    }

    const formValue = this.badgeForm.getRawValue();
    const payload = {
      name: formValue.name.trim(),
      departmentId: formValue.departmentId || null
    };

    this.isSaving = true;
    this.errorMessage = '';
    this.actionMessage = '';

    const request = this.editingBadgeId
      ? this.adminService.updateBadge(this.editingBadgeId, payload)
      : this.adminService.createBadge(payload);

    this.subscriptions.add(
      request.pipe(finalize(() => {
        this.isSaving = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      })).subscribe({
        next: () => {
          const message = this.editingBadgeId ? 'Badge updated.' : 'Badge created.';
          this.startCreate();
          this.actionMessage = message;
          this.refresh();
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to save this badge.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  deleteBadge(badge: BadgeTitle): void {
    if (badge.isDefault || this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.subscriptions.add(
      this.adminService.deleteBadge(badge.id)
        .pipe(finalize(() => {
          this.isSaving = false;
          this.renderScheduler.schedule(this.changeDetectorRef);
        }))
        .subscribe({
          next: () => {
            this.actionMessage = `${badge.name} deleted. Assigned members were moved to Member.`;
            this.startCreate();
            this.refresh();
            this.renderScheduler.schedule(this.changeDetectorRef);
          },
          error: () => {
            this.errorMessage = 'Unable to delete this badge.';
            this.renderScheduler.schedule(this.changeDetectorRef);
          }
        })
    );
  }

  get departmentOptions(): readonly AdminSelectOption[] {
    return [
      { value: '', label: 'Global badge' },
      ...this.departments.map((department) => ({
        value: department.id,
        label: department.name
      }))
    ];
  }

  get globalBadges(): BadgeTitle[] {
    return this.badges.filter((badge) => !badge.departmentId);
  }

  get filteredGlobalBadges(): BadgeTitle[] {
    const search = this.globalBadgeSearchControl.value.trim().toLowerCase();
    const globalBadges = this.globalBadges;

    if (!search) {
      return globalBadges;
    }

    return globalBadges.filter((badge) =>
      [
        badge.name,
        badge.isDefault ? 'default automatic every user' : 'available all departments',
        `${badge.userCount} members`
      ].join(' ').toLowerCase().includes(search)
    );
  }

  get defaultGlobalBadge(): BadgeTitle | null {
    return this.globalBadges.find((badge) => badge.isDefault) ?? null;
  }

  get departmentBadges(): BadgeTitle[] {
    return this.badges.filter((badge) => !!badge.departmentId);
  }

  trackByBadgeId(_: number, badge: BadgeTitle): string {
    return badge.id;
  }
}
