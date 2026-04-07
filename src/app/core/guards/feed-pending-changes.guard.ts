import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { FeedPageComponent } from '../../features/user-dashboard/pages/feed-page/feed-page.component';

@Injectable({ providedIn: 'root' })
export class FeedPendingChangesGuard implements CanDeactivate<FeedPageComponent> {
  canDeactivate(component: FeedPageComponent): boolean | Promise<boolean> {
    return component.canLeavePage();
  }
}
