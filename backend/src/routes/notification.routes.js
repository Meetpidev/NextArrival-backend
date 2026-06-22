const router = require("express").Router();
const ctrl = require("../controllers/notification.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.get("/", requireAuth, ctrl.getNotifications);
router.get("/unread-count", requireAuth, ctrl.getUnreadCount);
router.post("/device-tokens", requireAuth, ctrl.registerDeviceToken);
router.patch("/read-all", requireAuth, ctrl.markAllAsRead);
router.patch("/:id/read", requireAuth, ctrl.markAsRead);
router.delete("/:id", requireAuth, ctrl.deleteNotification);

module.exports = router;
