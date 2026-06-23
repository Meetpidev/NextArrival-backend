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
router.get("/contact-inquiries", requireAuth, requireRole("ADMIN"), ctrl.getContactInquiries);
router.patch(
  "/contact-inquiries/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.updateContactInquiryStatus,
);
router.get("/partner-requests", requireAuth, requireRole("ADMIN"), ctrl.getPartnerRequests);
router.get("/accepted-partners", requireAuth, requireRole("ADMIN"), ctrl.getAcceptedPartners);
router.patch(
  "/partner-requests/:id/status",
  requireAuth,
  requireRole("ADMIN"),
  ctrl.updatePartnerRequestStatus,
);
router.get("/notifications", requireAuth, requireRole("ADMIN"), ctrl.getNotificationRecords);

module.exports = router;
