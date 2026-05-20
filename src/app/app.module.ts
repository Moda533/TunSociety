import { APP_INITIALIZER, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { OverlayModule } from '@angular/cdk/overlay';
import { catchError, firstValueFrom, of } from 'rxjs';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthComponent } from './features/auth/pages/auth/auth.component';
import { UserDashboardComponent } from './features/user/pages/user-dashboard/user-dashboard.component';
import { AdminDashboardComponent } from './features/admin/pages/admin-dashboard/admin-dashboard.component';
import { ModerationComponent } from './features/moderation/pages/moderation/moderation.component';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { HttpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { ProfilePageComponent } from './features/user/pages/profile-page/profile-page.component';
import { MessengerPageComponent } from './features/user/pages/messenger-page/messenger-page.component';
import { NotificationsPageComponent } from './features/user/pages/notifications-page/notifications-page.component';
import { RequestsPageComponent } from './features/user/pages/requests-page/requests-page.component';
import { FeedPageComponent } from './features/user/pages/feed-page/feed-page.component';
import { EventDetailPageComponent } from './features/user/pages/event-detail-page/event-detail-page.component';
import { SearchPageComponent } from './features/user/pages/search-page/search-page.component';
import { SettingsPageComponent } from './features/user/pages/settings-page/settings-page.component';
import { MemberPageComponent } from './features/user/pages/member-page/member-page.component';
import { PostActionMenuComponent } from './features/user/components/post-action-menu/post-action-menu.component';
import { ProfilePhotosComponent } from './features/user/components/profile-photos/profile-photos.component';
import { ProfileGroupsPreviewComponent } from './features/user/components/profile-groups-preview/profile-groups-preview.component';
import { ModalShellComponent } from './shared/components/modal-shell/modal-shell.component';
import { AdminIconComponent } from './shared/components/admin-icon/admin-icon.component';
import { AdminSelectComponent } from './features/admin/components/admin-select/admin-select.component';
import { RootStartComponent } from './shared/components/root-start/root-start.component';
import { SessionEntryComponent } from './shared/components/session-entry/session-entry.component';
import { AuthService } from './core/services/auth.service';
import { AdminRootComponent } from './features/admin/pages/admin-root/admin-root.component';
import { AdminModerationComponent } from './features/admin/pages/admin-moderation/admin-moderation.component';
import { AdminAppealsComponent } from './features/admin/pages/admin-appeals/admin-appeals.component';
import { AdminBadgesComponent } from './features/admin/pages/admin-badges/admin-badges.component';
import { AdminDepartmentsComponent } from './features/admin/pages/admin-departments/admin-departments.component';
import { AdminEventEvaluationsComponent } from './features/admin/pages/admin-event-evaluations/admin-event-evaluations.component';
import { AdminRolePermissionsComponent } from './features/admin/pages/admin-role-permissions/admin-role-permissions.component';
import { AdminStatisticsOverviewComponent } from './features/admin/pages/admin-statistics-overview/admin-statistics-overview.component';
import { AdminUserDetailComponent } from './features/admin/pages/admin-user-detail/admin-user-detail.component';

@NgModule({
  declarations: [
    AppComponent,
    AuthComponent,
    UserDashboardComponent,
    ProfilePageComponent,
    MessengerPageComponent,
    NotificationsPageComponent,
    RequestsPageComponent,
    FeedPageComponent,
    EventDetailPageComponent,
    PostActionMenuComponent,
    ProfilePhotosComponent,
    ProfileGroupsPreviewComponent,
    SearchPageComponent,
    SettingsPageComponent,
    MemberPageComponent,
    ModalShellComponent,
    AdminIconComponent,
    RootStartComponent,
    SessionEntryComponent,
    AdminSelectComponent,
    AdminRootComponent,
    AdminDashboardComponent,
    AdminStatisticsOverviewComponent,
    AdminDepartmentsComponent,
    AdminBadgesComponent,
    AdminEventEvaluationsComponent,
    AdminRolePermissionsComponent,
    AdminModerationComponent,
    AdminAppealsComponent,
    AdminUserDetailComponent,
    ModerationComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    OverlayModule,
    AppRoutingModule
  ],
  providers: [
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AuthService],
      useFactory: (authService: AuthService) => () => {
        if (!authService.getToken()) {
          return Promise.resolve();
        }

        return firstValueFrom(
          authService.syncCurrentUser(true).pipe(catchError(() => of(null)))
        ).then(() => void 0);
      }
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: HttpErrorInterceptor,
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
