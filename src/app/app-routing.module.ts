import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminGuard } from './core/guards/admin.guard';
import { AuthGuard } from './core/guards/auth.guard';
import { FeedPendingChangesGuard } from './core/guards/feed-pending-changes.guard';
import { ModeratorGuard } from './core/guards/moderator.guard';
import { AdminDashboardComponent } from './features/admin-dashboard/admin-dashboard.component';
import { AuthComponent } from './features/auth/auth.component';
import { ModerationComponent } from './features/moderation/moderation.component';
import { UserDashboardComponent } from './features/user-dashboard/user-dashboard.component';
import { ProfilePageComponent } from './features/user-dashboard/pages/profile-page/profile-page.component';
import { MessengerPageComponent } from './features/user-dashboard/pages/messenger-page/messenger-page.component';
import { NotificationsPageComponent } from './features/user-dashboard/pages/notifications-page/notifications-page.component';
import { RequestsPageComponent } from './features/user-dashboard/pages/requests-page/requests-page.component';
import { FeedPageComponent } from './features/user-dashboard/pages/feed-page/feed-page.component';
import { SearchPageComponent } from './features/user-dashboard/pages/search-page/search-page.component';
import { MemberPageComponent } from './features/user-dashboard/pages/member-page/member-page.component';
import { AboutComponent } from './features/guest/about/about.component';
import { PolicyComponent } from './features/guest/policy/policy.component';
import { FeaturesComponent } from './features/guest/features/features.component';
import { ContactComponent } from './features/guest/contact/contact.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'about' },
  { path: 'about', component: AboutComponent },
  { path: 'policy', component: PolicyComponent },
  { path: 'features', component: FeaturesComponent },
  { path: 'contact', component: ContactComponent },
  { path: 'auth', component: AuthComponent },
  {
    path: 'dashboard',
    component: UserDashboardComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profile' },
      { path: 'profile', component: ProfilePageComponent },
      { path: 'messenger', component: MessengerPageComponent },
      { path: 'notifications', component: NotificationsPageComponent },
      { path: 'requests', component: RequestsPageComponent },
      { path: 'feed', component: FeedPageComponent, canDeactivate: [FeedPendingChangesGuard] },
      { path: 'search', component: SearchPageComponent },
      { path: 'members/:id', component: MemberPageComponent }
    ]
  },
  { path: 'moderation', component: ModerationComponent, canActivate: [AuthGuard, ModeratorGuard] },
  { path: 'admin', component: AdminDashboardComponent, canActivate: [AuthGuard, AdminGuard] },
  { path: '**', redirectTo: 'about' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    scrollPositionRestoration: 'top',
    anchorScrolling: 'disabled',
    scrollOffset: [0, 0]
  })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
