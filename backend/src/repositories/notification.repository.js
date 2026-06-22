const USER_NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  title: true,
  message: true,
  type: true,
  relatedId: true,
  relatedType: true,
  isRead: true,
  createdAt: true,
  updatedAt: true,
};

function createNotification(prisma, data) {
  return prisma.notification.create({
    data,
    select: USER_NOTIFICATION_SELECT,
  });
}

function getUserNotifications(prisma, { userId, page, limit, isRead, type }) {
  const where = {
    userId,
    ...(typeof isRead === "boolean" ? { isRead } : {}),
    ...(type ? { type } : {}),
  };
  const skip = (page - 1) * limit;

  return Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: USER_NOTIFICATION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

function getUnreadCount(prisma, userId) {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

function findUserNotification(prisma, { id, userId }) {
  return prisma.notification.findFirst({
    where: { id, userId },
    select: USER_NOTIFICATION_SELECT,
  });
}

function markAsRead(prisma, { id, userId }) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}

function markAllAsRead(prisma, userId) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

function deleteNotification(prisma, { id, userId }) {
  return prisma.notification.deleteMany({
    where: { id, userId },
  });
}

function findAdmins(prisma) {
  return prisma.user.findMany({
    where: { role: "ADMIN", isBanned: false },
    select: { id: true, fullName: true, email: true },
  });
}

function getActiveDeviceTokens(prisma, userIds) {
  return prisma.deviceToken.findMany({
    where: {
      userId: { in: userIds },
      isActive: true,
    },
    select: { id: true, userId: true, token: true },
  });
}

function upsertDeviceToken(prisma, { userId, token, platform }) {
  return prisma.deviceToken.upsert({
    where: { token },
    update: {
      userId,
      platform: platform || null,
      isActive: true,
    },
    create: {
      userId,
      token,
      platform: platform || null,
    },
  });
}

function deactivateDeviceTokens(prisma, tokens) {
  if (!tokens.length) {
    return Promise.resolve({ count: 0 });
  }

  return prisma.deviceToken.updateMany({
    where: { token: { in: tokens } },
    data: { isActive: false },
  });
}

function getAdminNotifications(prisma, { page, limit, type, isRead }) {
  const skip = (page - 1) * limit;
  const where = {
    user: { is: { role: "ADMIN" } },
    ...(type ? { type } : {}),
    ...(typeof isRead === "boolean" ? { isRead } : {}),
  };

  return Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      select: USER_NOTIFICATION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

module.exports = {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  findUserNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  findAdmins,
  getActiveDeviceTokens,
  upsertDeviceToken,
  deactivateDeviceTokens,
  getAdminNotifications,
};
