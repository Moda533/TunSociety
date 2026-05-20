import { Component, EventEmitter, Input, Output } from '@angular/core';

export type PostActionMenuAction =
  | 'hide'
  | 'report'
  | 'block-account'
  | 'share'
  | 'edit'
  | 'delete'
  | 'view-moderation'
  | 'approve'
  | 'flag'
  | 'block-post'
  | 'ai-classification';

type PostActionMenuIcon =
  | 'eye-off'
  | 'flag'
  | 'ban'
  | 'share'
  | 'edit'
  | 'trash'
  | 'shield'
  | 'check'
  | 'scan';

interface PostActionMenuItem {
  action: PostActionMenuAction;
  title: string;
  description?: string;
  icon: PostActionMenuIcon;
  tone?: 'default' | 'danger';
}

interface PostActionMenuGroup {
  items: PostActionMenuItem[];
}

@Component({
  selector: 'app-post-action-menu',
  standalone: false,
  templateUrl: './post-action-menu.component.html',
  styleUrls: ['./post-action-menu.component.scss']
})
export class PostActionMenuComponent {
  @Input() isOwner = false;
  @Input() canModerate = false;
  @Input() authorName = 'this account';
  @Input() itemLabel = 'post';
  @Output() menuAction = new EventEmitter<PostActionMenuAction>();

  get actionGroups(): PostActionMenuGroup[] {
    const groups: PostActionMenuGroup[] = [];

    if (this.isOwner) {
      groups.push({
        items: [
          {
            action: 'edit',
            title: `Edit ${this.itemLabel}`,
            description: this.itemLabel === 'event'
              ? 'Update the event details or banner.'
              : 'Update the text, media, or visibility.',
            icon: 'edit'
          },
          {
            action: 'delete',
            title: `Delete ${this.itemLabel}`,
            description: `Remove this ${this.itemLabel} from TunSociety.`,
            icon: 'trash',
            tone: 'danger'
          }
        ]
      });
    }

    if (!this.isOwner && !this.canModerate) {
      groups.push({
        items: [
          {
            action: 'hide',
            title: 'Hide post',
            description: 'Stop seeing this post in your feed.',
            icon: 'eye-off'
          },
          {
            action: 'report',
            title: 'Report post',
            description: 'Report harmful or inappropriate content.',
            icon: 'flag'
          },
          {
            action: 'block-account',
            title: 'Block account',
            description: `Stop seeing posts from ${this.authorName}.`,
            icon: 'ban',
            tone: 'danger'
          },
          {
            action: 'share',
            title: 'Share post',
            description: 'Copy or send a link to this post.',
            icon: 'share'
          }
        ]
      });
    }

    if (this.canModerate) {
      groups.push({
        items: [
          {
            action: 'view-moderation',
            title: 'View moderation details',
            description: 'Open the review workspace for this post.',
            icon: 'shield'
          },
          {
            action: 'approve',
            title: 'Approve post',
            description: 'Dismiss an active moderation case.',
            icon: 'check'
          },
          {
            action: 'flag',
            title: 'Flag post',
            description: 'Mark this post for human review.',
            icon: 'flag'
          },
          {
            action: 'block-post',
            title: 'Block post',
            description: 'Restrict content after review.',
            icon: 'ban',
            tone: 'danger'
          },
          {
            action: 'ai-classification',
            title: 'See AI classification result',
            description: 'Run a moderation check on this post.',
            icon: 'scan'
          }
        ]
      });
    }

    return groups;
  }

  selectAction(action: PostActionMenuAction): void {
    this.menuAction.emit(action);
  }

  trackGroup(index: number): number {
    return index;
  }

  trackItem(_: number, item: PostActionMenuItem): PostActionMenuAction {
    return item.action;
  }
}
