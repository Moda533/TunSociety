import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { finalize } from 'rxjs';
import { PERMISSIONS } from '../../../../core/permissions';
import { AuthService } from '../../../../core/services/auth.service';
import { RenderSchedulerService } from '../../../../core/services/render-scheduler.service';
import { AdminService } from '../../data-access/admin.service';
import { AdminRolePermissionCatalog, AdminRolePermissionSet } from '../../models/admin.model';

interface PermissionGroup {
  label: string;
  permissions: string[];
}

@Component({
  selector: 'app-admin-role-permissions',
  standalone: false,
  templateUrl: './admin-role-permissions.component.html',
  styleUrls: ['./admin-role-permissions.component.scss']
})
export class AdminRolePermissionsComponent implements OnInit {
  catalog: AdminRolePermissionCatalog | null = null;
  selectedRole = '';
  selectedPermissions = new Set<string>();
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  actionMessage = '';

  readonly protectedAdminPermissions: string[] = [
    PERMISSIONS.rolePermissionsRead,
    PERMISSIONS.rolePermissionsManage
  ];

  constructor(
    private readonly adminService: AdminService,
    private readonly authService: AuthService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly renderScheduler: RenderSchedulerService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  get canManageRolePermissions(): boolean {
    return this.authService.hasPermission(PERMISSIONS.rolePermissionsManage);
  }

  get rolePermissions(): AdminRolePermissionSet[] {
    return this.catalog?.rolePermissions ?? [];
  }

  get selectedRolePermissionCount(): number {
    return this.selectedPermissions.size;
  }

  get permissionGroups(): PermissionGroup[] {
    const permissions = this.catalog?.permissions ?? [];
    const groups = new Map<string, string[]>();

    for (const permission of permissions) {
      const [groupName] = permission.split('.');
      const label = this.labelForGroup(groupName);
      groups.set(label, [...(groups.get(label) ?? []), permission]);
    }

    return Array.from(groups.entries()).map(([label, groupPermissions]) => ({
      label,
      permissions: groupPermissions
    }));
  }

  load(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.adminService.getRolePermissions()
      .pipe(finalize(() => {
        this.isLoading = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (catalog) => {
          this.catalog = catalog;
          this.selectRole(this.selectedRole || catalog.roles[0] || '');
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to load role permissions right now.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  selectRole(role: string): void {
    this.selectedRole = role;
    const rolePermissionSet = this.rolePermissions.find((item) => item.role === role);
    this.selectedPermissions = new Set(rolePermissionSet?.permissions ?? []);

    if (role === 'Admin') {
      for (const permission of this.protectedAdminPermissions) {
        this.selectedPermissions.add(permission);
      }
    }
  }

  isSelected(permission: string): boolean {
    return this.selectedPermissions.has(permission);
  }

  permissionCountForRole(role: string): number {
    return this.rolePermissions.find((item) => item.role === role)?.permissions.length ?? 0;
  }

  isPermissionLocked(permission: string): boolean {
    return this.selectedRole === 'Admin' && this.protectedAdminPermissions.includes(permission);
  }

  togglePermission(permission: string, checked: boolean): void {
    if (this.isPermissionLocked(permission)) {
      return;
    }

    if (checked) {
      this.selectedPermissions.add(permission);
      return;
    }

    this.selectedPermissions.delete(permission);
  }

  save(): void {
    if (!this.selectedRole || !this.canManageRolePermissions) {
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.actionMessage = '';

    this.adminService.updateRolePermissions(this.selectedRole, Array.from(this.selectedPermissions))
      .pipe(finalize(() => {
        this.isSaving = false;
        this.renderScheduler.schedule(this.changeDetectorRef);
      }))
      .subscribe({
        next: (updated) => {
          this.applyUpdatedRole(updated);
          if (this.authService.getCurrentUser()?.role === updated.role) {
            this.authService.syncCurrentUser(true).subscribe();
          }
          this.actionMessage = `${updated.role} permissions updated.`;
          this.renderScheduler.schedule(this.changeDetectorRef);
        },
        error: () => {
          this.errorMessage = 'Unable to update role permissions right now.';
          this.renderScheduler.schedule(this.changeDetectorRef);
        }
      });
  }

  resetRole(): void {
    this.selectRole(this.selectedRole);
  }

  trackByRole(_: number, role: string): string {
    return role;
  }

  trackByPermission(_: number, permission: string): string {
    return permission;
  }

  private applyUpdatedRole(updated: AdminRolePermissionSet): void {
    if (!this.catalog) {
      return;
    }

    this.catalog = {
      ...this.catalog,
      rolePermissions: this.catalog.rolePermissions.map((item) =>
        item.role === updated.role ? updated : item
      )
    };

    this.selectRole(updated.role);
    this.renderScheduler.schedule(this.changeDetectorRef);
  }

  private labelForGroup(groupName: string): string {
    switch (groupName) {
      case 'users':
        return 'Users';
      case 'departments':
        return 'Departments';
      case 'badges':
        return 'Badges / Titles';
      case 'events':
        return 'Events';
      case 'appeals':
        return 'Appeals';
      case 'moderation':
        return 'Moderation';
      case 'role-permissions':
        return 'Roles & Permissions';
      default:
        return groupName;
    }
  }
}
