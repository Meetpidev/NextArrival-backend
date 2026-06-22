/*
 * Admin controller
 *
 * Handles admin-only operations:
 * - Analytics aggregation
 * - Moderating verifications + listings
 * - Refund request management
 * - Admin user management (ban/unban)
 */

const { prisma } = require("../config/db");
const {
  isZodError,
  sendValidationError,
  sendServerError,
} = require("../utils/http");
const { SUBSCRIPTION_PLANS } = require("../utils/constants");
const {
  adminInquiryQuerySchema,
  adminInquiryStatusSchema,
  adminInquiryIdParamSchema,
  notificationQuerySchema,
} = require("../schemas/validation");
const {
  listContactInquiries,
  updateContactInquiryStatus,
  listPartnerRequests,
  updatePartnerRequestStatus,
} = require("../services/adminInquiry.service");
const { getAdminNotifications } = require("../services/notification.service");

exports.getAnalytics = async (req, res) => {
  try {
    const totalTenants = await prisma.user.count({ where: { role: "TENANT" } });
    const totalOwners = await prisma.user.count({ where: { role: "OWNER" } });
    const totalListings = await prisma.listing.count({
      where: { status: { not: "ARCHIVED" } },
    });

    const revenueData = await prisma.subscription.aggregate({
      where: { isActive: true },
      _sum: { price: true },
    });
    const totalRevenue = revenueData._sum.price || 0;

    const totalVerificationsPending = await prisma.verificationRequest.count({
      where: { user: { verificationStatus: "PENDING_VERIFICATION" } },
    });

    res.json({ totalTenants, totalOwners, totalListings, totalRevenue, totalVerificationsPending });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch analytics");
  }
};

exports.getVerifications = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [total, list] = await Promise.all([
      prisma.verificationRequest.count(),
      prisma.verificationRequest.findMany({
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              role: true,
              verificationStatus: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({ total, page, limit, verifications: list });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch verification requests");
  }
};

exports.processVerification = async (req, res) => {
  try {
    const { userId, action, notes } = req.body;
    if (!userId || !action) {
      return res.status(400).json({ error: "User ID and action are required" });
    }
    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Invalid verification action" });
    }

    const status = action === "APPROVE" ? "VERIFIED" : "REJECTED";

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          verificationStatus: status,
          isVerified: action === "APPROVE",
        },
      }),
      prisma.verificationRequest.updateMany({
        where: { userId },
        data: { adminNotes: notes || null },
      }),
    ]);
    res.json({ message: "Verification processed successfully", status });
  } catch (err) {
    return sendServerError(
      res,
      "Verification processing error: " + err.message,
      "Failed to process verification",
    );
  }
};

exports.getListings = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const skip = (page - 1) * limit;

    const [total, listings] = await Promise.all([
      prisma.listing.count({ where: { status: { not: "ARCHIVED" } } }),
      prisma.listing.findMany({
        where: { status: { not: "ARCHIVED" } },
        include: {
          owner: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({ total, page, limit, listings });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch listings");
  }
};

exports.moderateListing = async (req, res) => {
  try {
    const { listingId, action, feedback } = req.body;
    if (!listingId || !action) {
      return res
        .status(400)
        .json({ error: "Listing ID and action are required" });
    }
    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Invalid listing action" });
    }

    const status = action === "APPROVE" ? "APPROVED" : "REJECTED";

    await prisma.listing.update({
      where: { id: listingId },
      data: { status, adminFeedback: feedback || null },
    });

    res.json({ message: "Listing moderated successfully", status });
  } catch (err) {
    return sendServerError(
      res,
      "Listing moderation error: " + err.message,
      "Failed to moderate listing",
    );
  }
};

exports.getRefundRequests = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [total, requests] = await Promise.all([
      prisma.refundRequest.count(),
      prisma.refundRequest.findMany({
        include: {
          user: { select: { id: true, fullName: true } },
          subscription: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    // Fetch all chat rooms in bulk to avoid N+1 queries
    const userIds = requests.map((r) => r.userId);
    const chatRoomsWithMessages = await prisma.chatRoom.findMany({
      where: { tenantId: { in: userIds } },
      include: {
        messages: {
          select: { senderId: true, roomId: true },
        },
      },
    });

    // Index chat rooms by tenant ID for efficient lookup
    const chatRoomsByTenant = chatRoomsWithMessages.reduce((acc, room) => {
      if (!acc[room.tenantId]) acc[room.tenantId] = [];
      acc[room.tenantId].push(room);
      return acc;
    }, {});

    const enriched = requests.map((entry) => {
      const rooms = chatRoomsByTenant[entry.userId] || [];
      const ownerRepliesReceived = rooms.reduce(
        (acc, room) =>
          acc + room.messages.filter((m) => m.senderId !== entry.userId).length,
        0,
      );

      return {
        ...entry,
        analytics: {
          approachesMade: rooms.length,
          ownerRepliesReceived,
          isEligible: ownerRepliesReceived === 0,
        },
      };
    });

    res.json({ total, page, limit, refundRequests: enriched });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch refund requests");
  }
};

exports.processRefundRequest = async (req, res) => {
  try {
    const { refundRequestId, action, notes } = req.body;
    if (!refundRequestId || !action) {
      return res
        .status(400)
        .json({ error: "Refund request ID and action are required" });
    }
    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Invalid refund action" });
    }

    const status = action === "APPROVE" ? "APPROVED" : "REJECTED";

    await prisma.$transaction(async (tx) => {
      const updated = await tx.refundRequest.update({
        where: { id: refundRequestId },
        data: { status, adminNotes: notes || null },
      });

      if (action === "APPROVE") {
        await tx.subscription.update({
          where: { id: updated.subscriptionId },
          data: { isActive: false },
        });
      }

      return updated;
    });
    res.json({ message: "Refund moderated successfully" });
  } catch (err) {
    return sendServerError(res, err, "Failed to process refund request");
  }
};

exports.getUsers = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [total, users] = await Promise.all([
      prisma.user.count({ where: { role: { in: ["TENANT", "OWNER"] } } }),
      prisma.user.findMany({
        where: { role: { in: ["TENANT", "OWNER"] } },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isVerified: true,
          isBanned: true,
          banReason: true,
          verificationStatus: true,
          currentCountry: true,
          plannedMoveDate: true,
          visaStatus: true,
          visaType: true,
          expectedRentalDuration: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const tenants = users.filter((u) => u.role === "TENANT");
    const owners = users.filter((u) => u.role === "OWNER");

    res.json({ total, page, limit, tenants, owners });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch users");
  }
};

exports.banUser = async (req, res) => {
  try {
    const { userId, action, reason } = req.body;
    if (!userId || !action) {
      return res.status(400).json({ error: "User ID and Action are required" });
    }
    if (!["BAN", "UNBAN"].includes(action)) {
      return res.status(400).json({ error: "Invalid user action" });
    }

    const isBanned = action === "BAN";
    const banReason = isBanned
      ? reason || "Violation of Community Guidelines"
      : null;

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned, banReason },
    });

    res.json({
      message: `User has been successfully ${isBanned ? "banned" : "unbanned"}.`,
      isBanned,
      banReason,
    });
  } catch (err) {
    return sendServerError(
      res,
      "User moderation error: " + err.message,
      "Failed to update user status",
    );
  }
};

exports.getSubscriptionsQueue = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [total, list] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.findMany({
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({ total, page, limit, subscriptions: list });
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch subscriptions");
  }
};

exports.moderateSubscription = async (req, res) => {
  try {
    const { subscriptionId, action } = req.body;
    if (!subscriptionId || !action) {
      return res.status(400).json({ error: "Subscription ID and action are required" });
    }
    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    const sub = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    if (sub.status !== "PENDING") {
      return res.status(400).json({ error: "Subscription is already processed" });
    }

    const status = action === "APPROVE" ? "APPROVED" : "REJECTED";
    const isActive = action === "APPROVE";

    await prisma.$transaction(async (tx) => {
      if (action === "APPROVE") {
        // Deactivate user's other active subscriptions
        await tx.subscription.updateMany({
          where: { userId: sub.userId, isActive: true },
          data: { isActive: false },
        });

        const startDate = new Date();
        const endDate = new Date(Date.now() + sub.durationDays * 24 * 60 * 60 * 1000);

        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            status,
            isActive,
            startDate,
            endDate,
          },
        });

        // Check if urgent match addon was purchased
        const plan = SUBSCRIPTION_PLANS.find((p) => p.id === sub.planId);
        const basePrice = plan ? (sub.isSubscription ? plan.priceSub : plan.priceOneTime) : sub.price;
        const hasUrgent = sub.price > basePrice;

        if (hasUrgent) {
          await tx.user.update({
            where: { id: sub.userId },
            data: { isUrgentMatch: true, urgentMatchRequestedAt: new Date() },
          });
        }
      } else {
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: { status, isActive },
        });
      }
    });

    res.json({ message: `Subscription ${action === "APPROVE" ? "approved" : "rejected"} successfully.` });
  } catch (err) {
    return sendServerError(res, err, "Failed to moderate subscription");
  }
};

exports.getContactInquiries = async (req, res) => {
  try {
    const query = adminInquiryQuerySchema.parse(req.query);
    const data = await listContactInquiries(query);

    return res.json({
      success: true,
      message: "Contact inquiries retrieved successfully",
      data,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendServerError(res, err, "Failed to fetch contact inquiries");
  }
};

exports.updateContactInquiryStatus = async (req, res) => {
  try {
    const { id } = adminInquiryIdParamSchema.parse(req.params);
    const { status } = adminInquiryStatusSchema.parse(req.body);
    const inquiry = await updateContactInquiryStatus({ id, status });

    return res.json({
      success: true,
      message: "Contact inquiry status updated successfully",
      data: { inquiry },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Contact inquiry not found",
      });
    }
    return sendServerError(res, err, "Failed to update contact inquiry");
  }
};

exports.getPartnerRequests = async (req, res) => {
  try {
    const query = adminInquiryQuerySchema.parse(req.query);
    const data = await listPartnerRequests(query);

    return res.json({
      success: true,
      message: "Partner requests retrieved successfully",
      data,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendServerError(res, err, "Failed to fetch partner requests");
  }
};

exports.updatePartnerRequestStatus = async (req, res) => {
  try {
    const { id } = adminInquiryIdParamSchema.parse(req.params);
    const { status } = adminInquiryStatusSchema.parse(req.body);
    const request = await updatePartnerRequestStatus({ id, status });

    return res.json({
      success: true,
      message: "Partner request status updated successfully",
      data: { request },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        error: "Partner request not found",
      });
    }
    return sendServerError(res, err, "Failed to update partner request");
  }
};

exports.getNotificationRecords = async (req, res) => {
  try {
    const query = notificationQuerySchema.parse(req.query);
    const data = await getAdminNotifications(query);

    return res.json({
      success: true,
      message: "Admin notifications retrieved successfully",
      data,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendServerError(res, err, "Failed to fetch admin notifications");
  }
};
