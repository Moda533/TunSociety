export const PERMISSIONS = {
  usersRead: 'users.read',
  usersEdit: 'users.edit',
  usersDelete: 'users.delete',
  departmentsRead: 'departments.read',
  departmentsManage: 'departments.manage',
  badgesRead: 'badges.read',
  badgesManage: 'badges.manage',
  eventsRead: 'events.read',
  eventsManage: 'events.manage',
  appealsRead: 'appeals.read',
  appealsReview: 'appeals.review',
  moderationReview: 'moderation.review',
  moderationFreeze: 'moderation.freeze',
  moderationBan: 'moderation.ban',
  rolePermissionsRead: 'role-permissions.read',
  rolePermissionsManage: 'role-permissions.manage'
} as const;

export const ADMIN_WORKSPACE_PERMISSIONS = [
  PERMISSIONS.usersRead,
  PERMISSIONS.usersEdit,
  PERMISSIONS.usersDelete,
  PERMISSIONS.departmentsRead,
  PERMISSIONS.departmentsManage,
  PERMISSIONS.badgesRead,
  PERMISSIONS.badgesManage,
  PERMISSIONS.eventsManage,
  PERMISSIONS.appealsRead,
  PERMISSIONS.appealsReview,
  PERMISSIONS.moderationReview,
  PERMISSIONS.moderationFreeze,
  PERMISSIONS.moderationBan,
  PERMISSIONS.rolePermissionsRead,
  PERMISSIONS.rolePermissionsManage
];

export const MODERATION_WORKSPACE_PERMISSIONS = [
  PERMISSIONS.moderationReview,
  PERMISSIONS.moderationFreeze,
  PERMISSIONS.appealsRead,
  PERMISSIONS.appealsReview
];
