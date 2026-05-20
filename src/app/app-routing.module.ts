import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminGuard } from './core/guards/admin.guard';
import { AuthGuard } from './core/guards/auth.guard';
import { FeedPendingChangesGuard } from './core/guards/feed-pending-changes.guard';
import { GuestGuard } from './core/guards/guest.guard';
import { LandingGuard } from './core/guards/landing.guard';
import { ModeratorGuard } from './core/guards/moderator.guard';
import { PermissionGuard } from './core/guards/permission.guard';
import { PERMISSIONS } from './core/permissions';
import { AdminDashboardComponent } from './features/admin/pages/admin-dashboard/admin-dashboard.component';
import { AdminRootComponent } from './features/admin/pages/admin-root/admin-root.component';
import { AdminModerationComponent } from './features/admin/pages/admin-moderation/admin-moderation.component';
import { AdminAppealsComponent } from './features/admin/pages/admin-appeals/admin-appeals.component';
import { AdminBadgesComponent } from './features/admin/pages/admin-badges/admin-badges.component';
import { AdminEventEvaluationsComponent } from './features/admin/pages/admin-event-evaluations/admin-event-evaluations.component';
import { AdminRolePermissionsComponent } from './features/admin/pages/admin-role-permissions/admin-role-permissions.component';
import { AdminStatisticsOverviewComponent } from './features/admin/pages/admin-statistics-overview/admin-statistics-overview.component';
import { AdminUserDetailComponent } from './features/admin/pages/admin-user-detail/admin-user-detail.component';
import { AdminDepartmentsComponent } from './features/admin/pages/admin-departments/admin-departments.component';
import {
  adminAppealsResolver,
  adminModerationQueueResolver,
  adminStatisticsOverviewResolver,
  adminUserDetailResolver,
  adminUsersResolver
} from './features/admin/data-access/admin-route.resolvers';
import { moderationWorkspaceResolver } from './features/moderation/data-access/moderation-route.resolvers';
import { AuthComponent } from './features/auth/pages/auth/auth.component';
import { ModerationComponent } from './features/moderation/pages/moderation/moderation.component';
import { UserDashboardComponent } from './features/user/pages/user-dashboard/user-dashboard.component';
import { ProfilePageComponent } from './features/user/pages/profile-page/profile-page.component';
import { MessengerPageComponent } from './features/user/pages/messenger-page/messenger-page.component';
import { NotificationsPageComponent } from './features/user/pages/notifications-page/notifications-page.component';
import { RequestsPageComponent } from './features/user/pages/requests-page/requests-page.component';
import { FeedPageComponent } from './features/user/pages/feed-page/feed-page.component';
import { EventDetailPageComponent } from './features/user/pages/event-detail-page/event-detail-page.component';
import { SearchPageComponent } from './features/user/pages/search-page/search-page.component';
import { SettingsPageComponent } from './features/user/pages/settings-page/settings-page.component';
import { RootStartComponent } from './shared/components/root-start/root-start.component';
import { SessionEntryComponent } from './shared/components/session-entry/session-entry.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', component: RootStartComponent },
  { path: 'about', component: SessionEntryComponent },
  { path: 'policy', component: SessionEntryComponent },
  { path: 'features', component: SessionEntryComponent },
  { path: 'contact', component: SessionEntryComponent },
  { path: 'auth', component: AuthComponent, canActivate: [GuestGuard] },
  { path: 'messages', redirectTo: '/dashboard/messenger', pathMatch: 'full' },
  { path: 'messages/:conversationId/settings', redirectTo: '/dashboard/messenger/:conversationId/settings' },
  { path: 'messages/:conversationId', redirectTo: '/dashboard/messenger/:conversationId' },
  {
    path: 'dashboard',
    component: UserDashboardComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profile' },
      { path: 'profile', component: ProfilePageComponent },
      { path: 'messenger', component: MessengerPageComponent },
      { path: 'messenger/:conversationId/settings', component: MessengerPageComponent },
      { path: 'messenger/:conversationId', component: MessengerPageComponent },
      { path: 'notifications', component: NotificationsPageComponent },
      { path: 'requests', component: RequestsPageComponent },
      { path: 'feed', component: FeedPageComponent, canDeactivate: [FeedPendingChangesGuard] },
      { path: 'events/:eventId', component: EventDetailPageComponent },
      { path: 'search', component: SearchPageComponent },
      { path: 'settings', component: SettingsPageComponent },
      { path: 'members/:id', component: ProfilePageComponent }
    ]
  },
  {
    path: 'moderation',
    component: ModerationComponent,
    canActivate: [AuthGuard, ModeratorGuard],
    resolve: { initialData: moderationWorkspaceResolver },
    runGuardsAndResolvers: 'always'
  },
  {
    path: 'admin',
    component: AdminRootComponent,
    canActivate: [AuthGuard, AdminGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        component: AdminDashboardComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.usersRead] },
        resolve: { users: adminUsersResolver },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'overview',
        component: AdminStatisticsOverviewComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.usersRead] },
        resolve: { initialData: adminStatisticsOverviewResolver },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'departments',
        component: AdminDepartmentsComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.departmentsRead] },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'badges',
        component: AdminBadgesComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.badgesRead] },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'event-evaluations',
        component: AdminEventEvaluationsComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.eventsManage] },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'role-permissions',
        component: AdminRolePermissionsComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.rolePermissionsRead] },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'moderation',
        component: AdminModerationComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.moderationReview] },
        resolve: { queue: adminModerationQueueResolver },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'users/:userId',
        component: AdminUserDetailComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.usersRead] },
        resolve: { initialData: adminUserDetailResolver },
        runGuardsAndResolvers: 'always'
      },
      {
        path: 'appeals',
        component: AdminAppealsComponent,
        canActivate: [PermissionGuard],
        data: { permissions: [PERMISSIONS.appealsRead] },
        resolve: { appeals: adminAppealsResolver },
        runGuardsAndResolvers: 'always'
      }
    ]
  },
  { path: '**', component: SessionEntryComponent, canActivate: [LandingGuard] }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    onSameUrlNavigation: 'reload',
    scrollPositionRestoration: 'top',
    anchorScrolling: 'disabled',
    scrollOffset: [0, 0]
  })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
