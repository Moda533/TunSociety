import { AdminActivityCategory, AdminActivityLog } from '../models/admin.model';

export type AdminActivityTone =
  | 'admin'
  | 'appeal'
  | 'content'
  | 'messaging'
  | 'moderation'
  | 'notification'
  | 'profile'
  | 'social'
  | 'system';

export function getAdminActivityTone(log: AdminActivityLog): AdminActivityTone {
  switch (normalizeCategory(log.category, log.action)) {
    case 'admin':
      return 'admin';
    case 'appeal':
      return 'appeal';
    case 'content':
      return 'content';
    case 'messaging':
      return 'messaging';
    case 'moderation':
      return 'moderation';
    case 'notification':
      return 'notification';
    case 'profile':
      return 'profile';
    case 'social':
      return 'social';
    default:
      return 'system';
  }
}

export function getAdminActivityTitle(log: AdminActivityLog): string {
  return log.actionLabel || log.action.replace(/\./g, ' ');
}

export function getAdminActivitySummary(log: AdminActivityLog): string {
  return log.summary || log.targetDisplayName || `${log.entityType} ${log.entityId}`;
}

export function formatAdminActivityCategory(value: string): string {
  switch (normalizeCategory(value)) {
    case 'admin':
      return 'Admin';
    case 'appeal':
      return 'Appeals';
    case 'content':
      return 'Content';
    case 'messaging':
      return 'Messaging';
    case 'moderation':
      return 'Moderation';
    case 'notification':
      return 'Notifications';
    case 'profile':
      return 'Profile';
    case 'social':
      return 'Social';
    default:
      return 'System';
  }
}

export function normalizeCategory(value: string, fallbackAction = ''): Exclude<AdminActivityCategory, 'All'> {
  const normalized = value.trim().toLowerCase();

  if (normalized) {
    return normalized as Exclude<AdminActivityCategory, 'All'>;
  }

  if (fallbackAction.startsWith('post.')) {
    return 'content';
  }

  if (fallbackAction.startsWith('moderation.')) {
    return 'moderation';
  }

  if (fallbackAction.startsWith('appeal.')) {
    return 'appeal';
  }

  if (fallbackAction.startsWith('admin.')) {
    return 'admin';
  }

  if (fallbackAction.startsWith('user.')) {
    return 'profile';
  }

  if (fallbackAction.startsWith('friendrequest.')) {
    return 'social';
  }

  if (fallbackAction.startsWith('directmessage.') || fallbackAction.startsWith('message.')) {
    return 'messaging';
  }

  if (fallbackAction.startsWith('notification.')) {
    return 'notification';
  }

  return 'system';
}
