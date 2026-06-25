const { childLogger } = require("../config/logger");
const logger = childLogger("subscription-controller");
/*
 * Subscription controller
 *
 * Handles subscription lifecycle:
 * - create/purchase subscription plans
 * - list user's subscriptions
 * - create refund request
 */

const { prisma } = require("../config/db");
const {
  SUBSCRIPTION_PLANS,
  URGENT_MATCH_ADDON,
} = require("../utils/constants");

const {
  createSubscriptionSchema,
  subscriptionQuerySchema,
  createRefundRequestSchema,
} = require("../schemas/validation");
const { isZodError, sendValidationError } = require("../utils/http");

exports.createSubscription = async (req, res) => {
  try {
    // Validate authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Validate input using Zod schema
    const validated = createSubscriptionSchema.parse(req.body);
    const { planId, type, purchaseUrgentMatch } = validated;

    const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
    if (!plan) {
      return res
        .status(400)
        .json({ error: "Invalid subscription package selected" });
    }

    // Validate subscription type
    const normalizedType = String(type || "SUBSCRIPTION").toUpperCase();
    const isSubscription = normalizedType === "SUBSCRIPTION";

    // Validate price values
    const purchaseUrgent =
      purchaseUrgentMatch === true || purchaseUrgentMatch === "true";
    let finalPrice = isSubscription ? plan.priceSub : plan.priceOneTime;
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(500).json({ error: "Invalid pricing configuration" });
    }

    if (purchaseUrgent) {
      finalPrice += URGENT_MATCH_ADDON.price;
      if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
        return res.status(500).json({ error: "Invalid pricing configuration" });
      }
    }

    const startDate = new Date();
    const endDate = new Date(
      Date.now() + plan.durationDays * 24 * 60 * 60 * 1000,
    );

    await prisma.$transaction(async (tx) => {
      // Prevent duplicate submissions within last 10 seconds (any plan)
      const recentSub = await tx.subscription.findFirst({
        where: {
          userId: req.user.id,
          createdAt: { gte: new Date(Date.now() - 10000) },
        },
      });
      if (recentSub) {
        throw new Error("DUPLICATE_REQUEST");
      }

      // Check if there is already a pending request for the user
      const existingPending = await tx.subscription.findFirst({
        where: {
          userId: req.user.id,
          status: "PENDING",
        },
      });
      if (existingPending) {
        throw new Error("PENDING_REQUEST_EXISTS");
      }

      await tx.subscription.create({
        data: {
          userId: req.user.id,
          planId: plan.id,
          name: plan.name,
          price: finalPrice,
          durationDays: plan.durationDays,
          isSubscription,
          approachesAllowed: plan.approachesLimit,
          startDate,
          endDate,
          isActive: false,
          status: "PENDING",
        },
      });
    });

    res.json({ message: `Successfully requested ${plan.name}! It is pending admin approval.` });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    if (err.message?.includes("PAYMENT_NOT_IMPLEMENTED")) {
      return res.status(501).json({
        error:
          "Payment processing is not yet configured. Please contact support.",
      });
    }
    if (err.message === "DUPLICATE_REQUEST" || err.message === "PENDING_REQUEST_EXISTS") {
      return res.status(409).json({
        error:
          "A subscription request is already pending. Please wait before submitting another.",
      });
    }
    logger.error({ err }, "Subscription creation failed");
    res.status(500).json({
      error: "Unable to process subscription. Please try again.",
    });
  }
};

exports.getSubscriptions = async (req, res) => {
  try {
    // Validate authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Validate and sanitize pagination parameters using Zod
    const validated = subscriptionQuerySchema.parse(req.query);
    const { page, limit } = validated;

    const skip = (page - 1) * limit;
    const whereClause = { userId: req.user.id };

    // Fetch subscriptions and total count in parallel
    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.subscription.count({ where: whereClause }),
    ]);

    res.json({ subscriptions, page, limit, total });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Subscriptions fetch error");
    res.status(500).json({
      error: "Unable to retrieve subscriptions. Please try again.",
    });
  }
};

exports.createRefundRequest = async (req, res) => {
  try {
    // Validate authentication
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Validate input using Zod schema
    const validated = createRefundRequestSchema.parse(req.body);
    const { subscriptionId, reason } = validated;

    // Fetch subscription and duplicate check in parallel
    const [sub, duplicate] = await Promise.all([
      prisma.subscription.findUnique({
        where: { id: subscriptionId },
      }),
      prisma.refundRequest.findFirst({
        where: { subscriptionId },
      }),
    ]);

    // Validate subscription ownership
    if (!sub || sub.userId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Validate subscription is active
    if (!sub.isActive) {
      return res.status(400).json({
        error: "Cannot refund inactive subscription",
      });
    }

    // Validate subscription has valid startDate
    if (!sub.startDate || !(sub.startDate instanceof Date)) {
      return res.status(500).json({
        error: "Invalid subscription data. Please contact support.",
      });
    }

    // Enforce 7-day refund window from purchase
    const daysSincePurchase =
      (Date.now() - new Date(sub.startDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePurchase > 7) {
      return res.status(400).json({
        error: "Refund window has expired (7 days from purchase date)",
      });
    }

    // Check for duplicate refund request
    if (duplicate) {
      return res.status(400).json({
        error: "Refund claim already filed for this subscription",
      });
    }

    // Create refund request
    await prisma.refundRequest.create({
      data: {
        userId: req.user.id,
        subscriptionId,
        reason,
        status: "PENDING",
      },
    });

    res.json({ message: "Refund application submitted to auditing queue." });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Refund request error");
    res.status(500).json({
      error: "Unable to submit refund request. Please try again.",
    });
  }
};
