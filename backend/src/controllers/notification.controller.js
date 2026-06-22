const {
  notificationQuerySchema,
  notificationIdParamSchema,
  deviceTokenSchema,
} = require("../schemas/validation");
const {
  NotificationServiceError,
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  registerDeviceToken,
} = require("../services/notification.service");
const { isZodError, sendValidationError } = require("../utils/http");

function sendNotificationError(res, err) {
  if (err instanceof NotificationServiceError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  console.error("Notification API error:", err);
  return res.status(500).json({
    success: false,
    error: "Unable to process notification request",
  });
}

exports.getNotifications = async (req, res) => {
  try {
    const query = notificationQuerySchema.parse(req.query);
    const data = await getUserNotifications(req.user.id, query);

    return res.json({
      success: true,
      message: "Notifications retrieved successfully",
      data,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendNotificationError(res, err);
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const count = await getUnreadCount(req.user.id);

    return res.json({
      success: true,
      message: "Unread count retrieved successfully",
      data: { count },
    });
  } catch (err) {
    return sendNotificationError(res, err);
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const { id } = notificationIdParamSchema.parse(req.params);
    const notification = await markAsRead(req.user.id, id);

    return res.json({
      success: true,
      message: "Notification marked as read",
      data: { notification },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendNotificationError(res, err);
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const result = await markAllAsRead(req.user.id);

    return res.json({
      success: true,
      message: "All notifications marked as read",
      data: { updatedCount: result.count },
    });
  } catch (err) {
    return sendNotificationError(res, err);
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const { id } = notificationIdParamSchema.parse(req.params);
    await deleteNotification(req.user.id, id);

    return res.json({
      success: true,
      message: "Notification deleted successfully",
      data: {},
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendNotificationError(res, err);
  }
};

exports.registerDeviceToken = async (req, res) => {
  try {
    const data = deviceTokenSchema.parse(req.body);
    const deviceToken = await registerDeviceToken(req.user.id, data);

    return res.status(201).json({
      success: true,
      message: "Device token registered successfully",
      data: { deviceToken },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendNotificationError(res, err);
  }
};

module.exports.sendNotificationError = sendNotificationError;
