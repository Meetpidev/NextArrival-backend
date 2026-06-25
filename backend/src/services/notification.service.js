const { prisma } = require("../config/db");
const repo = require("../repositories/notification.repository");
const queueProvider = require("../providers/notificationQueue.provider");
const firebaseProvider = require("../providers/firebase.provider");

class NotificationServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "NotificationServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function buildQueuePayload(notification) {
  return {
    notificationId: notification.id,
    userIds: [notification.userId],
    title: notification.title,
    message: notification.message,
    type: notification.type,
    relatedId: notification.relatedId,
    relatedType: notification.relatedType,
  };
}

async function enqueueNotificationJob(payload) {
  try {
    return await queueProvider.enqueueNotificationJob(payload);
  } catch (err) {
    logger.error({ err }, "Failed to enqueue notification job");
    return { queued: false, reason: err.message };
  }
}

async function createNotification(data, options = {}) {
  const client = options.prisma || prisma;
  const enqueue = options.enqueue !== false;
  const awaitQueue = options.awaitQueue === true;

  const notification = await repo.createNotification(client, {
    userId: data.userId,
    title: data.title,
    message: data.message,
    type: data.type,
    relatedId: data.relatedId || null,
    relatedType: data.relatedType || null,
  });

  if (enqueue) {
    const queuePromise = enqueueNotificationJob(buildQueuePayload(notification));
    if (awaitQueue) {
      await queuePromise;
    }
  }

  return notification;
}

async function createAdminNotification(data, options = {}) {
  const client = options.prisma || prisma;
  const admins = await repo.findAdmins(client);

  if (!admins.length) {
    logger.warn("No active admin users found for admin notification");
    return [];
  }

  const notifications = [];
  for (const adminUser of admins) {
    const notification = await createNotification(
      {
        userId: adminUser.id,
        title: data.title,
        message: data.message,
        type: data.type,
        relatedId: data.relatedId,
        relatedType: data.relatedType,
      },
      { prisma: client, enqueue: false },
    );
    notifications.push(notification);
  }

  if (options.enqueue !== false) {
    const queuePromise = enqueueNotificationJob({
      notificationIds: notifications.map((item) => item.id),
      userIds: admins.map((adminUser) => adminUser.id),
      title: data.title,
      message: data.message,
      type: data.type,
      relatedId: data.relatedId || null,
      relatedType: data.relatedType || null,
    });

    if (options.awaitQueue === true) {
      await queuePromise;
    }
  }

  return notifications;
}

async function getUserNotifications(userId, query) {
  const [total, notifications] = await repo.getUserNotifications(prisma, {
    userId,
    ...query,
  });

  return {
    notifications,
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

async function getUnreadCount(userId) {
  return repo.getUnreadCount(prisma, userId);
}

async function markAsRead(userId, notificationId) {
  const result = await repo.markAsRead(prisma, { id: notificationId, userId });
  if (result.count === 0) {
    throw new NotificationServiceError(
      "NOTIFICATION_NOT_FOUND",
      "Notification not found",
      404,
    );
  }

  return repo.findUserNotification(prisma, { id: notificationId, userId });
}

async function markAllAsRead(userId) {
  return repo.markAllAsRead(prisma, userId);
}

async function deleteNotification(userId, notificationId) {
  const result = await repo.deleteNotification(prisma, {
    id: notificationId,
    userId,
  });

  if (result.count === 0) {
    throw new NotificationServiceError(
      "NOTIFICATION_NOT_FOUND",
      "Notification not found",
      404,
    );
  }

  return { deleted: true };
}

async function registerDeviceToken(userId, { token, platform }) {
  return repo.upsertDeviceToken(prisma, { userId, token, platform });
}

async function sendPushNotification(job) {
  const userIds = Array.isArray(job.userIds) ? job.userIds.filter(Boolean) : [];
  if (!userIds.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const deviceTokens = await repo.getActiveDeviceTokens(prisma, userIds);
  const tokens = deviceTokens.map((item) => item.token);
  const result = await firebaseProvider.sendPushNotification({
    tokens,
    title: job.title,
    message: job.message,
    data: {
      notificationId: job.notificationId,
      type: job.type,
      relatedId: job.relatedId,
      relatedType: job.relatedType,
    },
  });

  if (result.invalidTokens.length) {
    await repo.deactivateDeviceTokens(prisma, result.invalidTokens);
  }

  return result;
}

async function getAdminNotifications(query) {
  const [total, notifications] = await repo.getAdminNotifications(prisma, query);
  return {
    notifications,
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

module.exports = {
  NotificationServiceError,
  createNotification,
  createAdminNotification,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  enqueueNotificationJob,
  sendPushNotification,
  registerDeviceToken,
  getAdminNotifications,
};
