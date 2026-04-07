import { APP_INITIALIZER, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { catchError, firstValueFrom, of } from 'rxjs';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthComponent } from './features/auth/auth.component';
import { UserDashboardComponent } from './features/user-dashboard/user-dashboard.component';
import { AdminDashboardComponent } from './features/admin-dashboard/admin-dashboard.component';
import { ModerationComponent } from './features/moderation/moderation.component';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { HttpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { AboutComponent } from './features/guest/about/about.component';
import { PolicyComponent } from './features/guest/policy/policy.component';
import { FeaturesComponent } from './features/guest/features/features.component';
import { ContactComponent } from './features/guest/contact/contact.component';
import { ProfilePageComponent } from './features/user-dashboard/pages/profile-page/profile-page.component';
import { MessengerPageComponent } from './features/user-dashboard/pages/messenger-page/messenger-page.component';
import { NotificationsPageComponent } from './features/user-dashboard/pages/notifications-page/notifications-page.component';
import { RequestsPageComponent } from './features/user-dashboard/pages/requests-page/requests-page.component';
import { FeedPageComponent } from './features/user-dashboard/pages/feed-page/feed-page.component';
import { SearchPageComponent } from './features/user-dashboard/pages/search-page/search-page.component';
import { MemberPageComponent } from './features/user-dashboard/pages/member-page/member-page.component';
import { ModalShellComponent } from './shared/components/modal-shell/modal-shell.component';
import { AuthService } from './core/services/auth.service';

@NgModule({
  declarations: [
    AppComponent,
    AboutComponent,
    PolicyComponent,
    FeaturesComponent,
    ContactComponent,
    AuthComponent,
    UserDashboardComponent,
    ProfilePageComponent,
    MessengerPageComponent,
    NotificationsPageComponent,
    RequestsPageComponent,
    FeedPageComponent,
    SearchPageComponent,
    MemberPageComponent,
    ModalShellComponent,
    AdminDashboardComponent,
    ModerationComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
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
