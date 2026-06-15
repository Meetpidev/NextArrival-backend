const router = require("express").Router();
const ctrl = require("../controllers/admin.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");

router.get("/analytics", requireAuth, requireRole("ADMIN"), ctrl.getAnalytics);
router.get(
  "/verifications",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.getVerifications,
);
router.post(
  "/verifications",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.processVerification,
);
router.get("/listings", requireAuth, requireRole("ADMIN"), ctrl.getListings);
router.post(
  "/listings/moderate",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.moderateListing,
);
router.get(
  "/refunds",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.getRefundRequests,
);
router.put(
  "/refunds",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.processRefundRequest,
);
router.get("/users", requireAuth, requireRole("ADMIN"), ctrl.getUsers);
router.post("/users/ban", requireAuth, requireRole("ADMIN"), ctrl.banUser);
router.get("/subscriptions", requireAuth, requireRole("ADMIN"), ctrl.getSubscriptionsQueue);
router.post("/subscriptions/moderate", requireAuth, requireRole("ADMIN"), ctrl.moderateSubscription);

module.exports = router;
