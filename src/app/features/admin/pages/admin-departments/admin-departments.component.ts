import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Subscription, finalize, forkJoin } from 'rxjs';
import { PERMISSIONS } from '../../../../core/permissions';
import { AuthService } from '../../../../core/services/auth.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { AdminSelectOption } from '../../components/admin-select/admin-select.component';
import { AdminService } from '../../data-access/admin.service';
import { Department, AdminUserRiskSummary, BadgeTitle } from '../../models/admin.model';

@Component({
  selector: 'app-admin-departments',
  standalone: false,
  templateUrl: './admin-departments.component.html',
  styleUrls: ['./admin-departments.component.scss']
})
export class AdminDepartmentsComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);

  readonly departmentForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: ['']
  });

  departments: Department[] = [];
  users: AdminUserRiskSummary[] = [];
  badges: BadgeTitle[] = [];
  selectedDepartmentId = '';
  editingDepartmentId = '';
  isLoading = false;
  isSaving = false;
  isDepartmentEditorOpen = false;
  updatingUserId = '';
  errorMessage = '';
  actionMessage = '';

  private readonly subscriptions = new Subscription();

  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService
  ) {}

  get canManageDepartments(): boolean {
    return this.authService.hasPermission(PERMISSIONS.departmentsManage);
  }

  get canEditMembership(): boolean {
    return this.authService.hasPermission(PERMISSIONS.usersEdit);
  }

  get canOpenBadges(): boolean {
    return this.authService.hasPermission(PERMISSIONS.badgesRead);
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
        departments: this.adminService.getDepartments(),
        users: this.adminService.getUsers(0, 200),
        badges: this.adminService.getBadges()
      }).pipe(finalize(() => {
        this.isLoading = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      })).subscribe({
        next: ({ departments, users, badges }) => {
          this.departments = departments;
          this.users = users;
          this.badges = badges;
          if (!this.selectedDepartmentId && departments.length) {
            this.selectedDepartmentId = departments[0].id;
          }
          if (this.selectedDepartmentId && !departments.some((department) => department.id === this.selectedDepartmentId)) {
            this.selectedDepartmentId = departments[0]?.id ?? '';
          }
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to load departments right now.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  startCreate(): void {
    this.openCreateDepartment();
  }

  openCreateDepartment(): void {
    this.editingDepartmentId = '';
    this.departmentForm.reset({ name: '', description: '' });
    this.isDepartmentEditorOpen = true;
    this.actionMessage = '';
    this.errorMessage = '';
  }

  closeDepartmentEditor(): void {
    this.editingDepartmentId = '';
    this.departmentForm.reset({ name: '', description: '' });
    this.isDepartmentEditorOpen = false;
  }

  editDepartment(department: Department): void {
    this.editingDepartmentId = department.id;
    this.selectedDepartmentId = department.id;
    this.isDepartmentEditorOpen = true;
    this.departmentForm.reset({
      name: department.name,
      description: department.description
    });
    this.actionMessage = '';
    this.errorMessage = '';
  }

  saveDepartment(): void {
    if (this.departmentForm.invalid || this.isSaving) {
      this.departmentForm.markAllAsTouched();
      return;
    }

    const payload = {
      name: this.departmentForm.controls.name.value.trim(),
      description: this.departmentForm.controls.description.value.trim()
    };

    this.isSaving = true;
    this.errorMessage = '';
    this.actionMessage = '';

    const request = this.editingDepartmentId
      ? this.adminService.updateDepartment(this.editingDepartmentId, payload)
      : this.adminService.createDepartment(payload);

    this.subscriptions.add(
      request.pipe(finalize(() => {
        this.isSaving = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      })).subscribe({
        next: (department) => {
          const message = this.editingDepartmentId ? 'Department updated.' : 'Department created.';
          this.selectedDepartmentId = department.id;
          this.closeDepartmentEditor();
          this.actionMessage = message;
          this.refresh();
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to save this department.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  archiveDepartment(department: Department): void {
    if (this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.subscriptions.add(
      this.adminService.archiveDepartment(department.id)
        .pipe(finalize(() => {
          this.isSaving = false;
          this.renderScheduler.schedule(this.changeDetectorRef);
        }))
        .subscribe({
          next: () => {
            this.actionMessage = `${department.name} archived. Assigned members are now unassigned.`;
            this.selectedDepartmentId = '';
            this.closeDepartmentEditor();
            this.refresh();
            this.renderScheduler.schedule(this.changeDetectorRef);
          },
          error: () => {
            this.errorMessage = 'Unable to archive this department.';
            this.renderScheduler.schedule(this.changeDetectorRef);
          }
        })
    );
  }

  selectDepartment(department: Department): void {
    this.selectedDepartmentId = department.id;
  }

  assignUserToSelectedDepartment(user: AdminUserRiskSummary): void {
    if (!this.selectedDepartmentId) {
      return;
    }

    const badgeId = this.defaultBadgeIdFor(this.selectedDepartmentId, user.badgeId);
    this.updateUserMembership(user, this.selectedDepartmentId, badgeId);
  }

  updateUserDepartment(user: AdminUserRiskSummary, nextDepartmentId: string): void {
    const departmentId = nextDepartmentId || null;
    const badgeId = this.isBadgeAllowedForDepartment(user.badgeId, departmentId)
      ? user.badgeId
      : this.defaultBadgeIdFor(departmentId, user.badgeId);

    this.updateUserMembership(user, departmentId, badgeId);
  }

  updateUserBadge(user: AdminUserRiskSummary, nextBadgeId: string): void {
    this.updateUserMembership(user, user.departmentId, nextBadgeId || this.defaultBadgeIdFor(user.departmentId, user.badgeId));
  }

  get selectedDepartment(): Department | null {
    return this.departments.find((department) => department.id === this.selectedDepartmentId) ?? null;
  }

  get selectedDepartmentUsers(): AdminUserRiskSummary[] {
    if (!this.selectedDepartmentId) {
      return [];
    }

    return this.users.filter((user) => user.departmentId === this.selectedDepartmentId);
  }

  get unassignedUsers(): AdminUserRiskSummary[] {
    return this.users.filter((user) => !user.departmentId);
  }

  get assignedUserCount(): number {
    return this.users.length - this.unassignedUsers.length;
  }

  get departmentOptions(): readonly AdminSelectOption[] {
    return [
      { value: '', label: 'Unassigned' },
      ...this.departments.map((department) => ({
        value: department.id,
        label: department.name
      }))
    ];
  }

  get activeDepartmentOptions(): readonly AdminSelectOption[] {
    return this.departments.map((department) => ({
      value: department.id,
      label: department.name
    }));
  }

  getBadgeOptionsForUser(user: AdminUserRiskSummary): readonly AdminSelectOption[] {
    return this.badges
      .filter((badge) => !badge.departmentId || badge.departmentId === user.departmentId || badge.id === user.badgeId)
      .map((badge) => ({
        value: badge.id,
        label: badge.departmentName ? `${badge.name} (${badge.departmentName})` : badge.name
      }));
  }

  trackByDepartmentId(_: number, department: Department): string {
    return department.id;
  }

  trackByUserId(_: number, user: AdminUserRiskSummary): string {
    return user.id;
  }

  private updateUserMembership(user: AdminUserRiskSummary, departmentId: string | null, badgeId: string): void {
    if (this.updatingUserId || !badgeId) {
      return;
    }

    this.updatingUserId = user.id;
    this.errorMessage = '';
    this.actionMessage = '';

    this.subscriptions.add(
      this.adminService.updateUserMembership(user.id, {
        departmentId,
        badgeId
      }).pipe(finalize(() => {
        this.updatingUserId = '';
        this.renderScheduler.schedule(this.changeDetectorRef);
      })).subscribe({
        next: (updatedUser) => {
          this.actionMessage = `Updated ${updatedUser.displayName || updatedUser.userName}'s department assignment.`;
          this.refresh();
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to update this member assignment.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      })
    );
  }

  private defaultBadgeIdFor(departmentId: string | null, fallbackBadgeId: string): string {
    return this.badges.find((badge) => badge.isDefault)?.id
      ?? this.badges.find((badge) => !badge.departmentId || badge.departmentId === departmentId)?.id
      ?? fallbackBadgeId;
  }

  private isBadgeAllowedForDepartment(badgeId: string, departmentId: string | null): boolean {
    const badge = this.badges.find((item) => item.id === badgeId);
    return !badge || !badge.departmentId || badge.departmentId === departmentId;
  }
}
