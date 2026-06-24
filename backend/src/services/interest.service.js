const { prisma } = require("../config/db");
const repo = require("../repositories/interest.repository");
const {
  createNotification,
  enqueueNotificationJob,
} = require("./notification.service");

const DAILY_TENANT_INQUIRY_LIMIT = 10;

class InterestServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "InterestServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sanitizePlainText(value) {
  return String(value || "")
    .replace(/[<>"'&]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function buildProfileSnapshot(tenant) {
  return {
    tenantId: tenant.id,
    tenantName: tenant.fullName,
    nationality: tenant.currentCountry || null,
    countryOfOrigin: tenant.currentCountry || null,
    destinationCountry: tenant.destinationCountry || null,
    verificationStatus: tenant.verificationStatus,
    approvedProfileDetails: {
      residencyStatus: tenant.residencyStatus || null,
      currentStatus: tenant.currentStatus || null,
      visaStatus: tenant.visaStatus || null,
      visaType: tenant.visaType || null,
      plannedMoveDate: tenant.plannedMoveDate || null,
      purposeOfRelocation: tenant.purposeOfRelocation || null,
      expectedRentalDuration: tenant.expectedRentalDuration || null,
      isUrgentMatch: Boolean(tenant.isUrgentMatch),
    },
  };
}

function buildPropertySnapshot(property) {
  return {
    propertyId: property.id,
    title: property.title,
    rent: property.rent,
    location: property.location,
    city: property.city,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    availabilityDate: property.availabilityDate
      ? property.availabilityDate.toISOString()
      : null,
  };
}

function buildInterestMessageContent(profileSnapshot, propertySnapshot, message) {
  const lines = [
    `${profileSnapshot.tenantName || "A verified tenant"} is interested in ${propertySnapshot.title}.`,
    `Verification status: ${profileSnapshot.verificationStatus}.`,
  ];

  if (profileSnapshot.countryOfOrigin) {
    lines.push(`Country of origin: ${profileSnapshot.countryOfOrigin}.`);
  }

  lines.push(`Message: ${message}`);

  return lines.join("\n");
}

function enqueueInterestNotification(notification, userIds, logLabel) {
  try {
    void enqueueNotificationJob({
      notificationId: notification.id,
      userIds,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      relatedId: notification.relatedId,
      relatedType: notification.relatedType,
    }).catch((enqueueError) => {
      console.error(`Failed to enqueue notification after ${logLabel}:`, enqueueError);
    });
  } catch (enqueueError) {
    console.error(`Failed to enqueue notification after ${logLabel}:`, enqueueError);
  }
}

async function createInterestRequest({ tenant, propertyId, message }) {
  if (tenant.role !== "TENANT") {
    throw new InterestServiceError(
      "ROLE_NOT_ALLOWED",
      "Only tenants can send interest requests",
      403,
    );
  }

  if (tenant.verificationStatus !== "VERIFIED") {
    throw new InterestServiceError(
      "TENANT_NOT_VERIFIED",
      "Complete verification before sending interest requests",
      403,
    );
  }

  const activeSub =
    tenant.subscriptions?.[0] ||
    (await repo.findActiveSubscription(prisma, tenant.id));

  if (!activeSub) {
    throw new InterestServiceError(
      "ACTIVE_PLAN_REQUIRED",
      "Active plan required to contact owner",
      403,
    );
  }

  const property = await repo.findPropertyById(prisma, propertyId);
  if (!property) {
    throw new InterestServiceError("PROPERTY_NOT_FOUND", "Property not found", 404);
  }

  if (property.ownerId === tenant.id) {
    throw new InterestServiceError(
      "OWN_PROPERTY",
      "Cannot send interest request for your own property",
      400,
    );
  }

  if (property.status !== "APPROVED") {
    throw new InterestServiceError(
      "PROPERTY_NOT_AVAILABLE",
      "Cannot send interest request for this property",
      403,
    );
  }

  const existingInquiry = await repo.findByTenantAndProperty(
    prisma,
    tenant.id,
    propertyId,
  );
  if (existingInquiry) {
    throw new InterestServiceError(
      "INQUIRY_EXISTS",
      "An inquiry already exists for this property",
      409,
    );
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const requestsToday = await repo.countTenantRequestsSince(prisma, {
    tenantId: tenant.id,
    since: dayStart,
  });

  if (requestsToday >= DAILY_TENANT_INQUIRY_LIMIT) {
    throw new InterestServiceError(
      "DAILY_INQUIRY_LIMIT_REACHED",
      "Daily inquiry limit reached. Please try again tomorrow.",
      429,
    );
  }

  const profileSnapshot = buildProfileSnapshot(tenant);
  const propertySnapshot = buildPropertySnapshot(property);
  const trimmedMessage = sanitizePlainText(message);
  if (!trimmedMessage) {
    throw new InterestServiceError(
      "MESSAGE_REQUIRED",
      "Message is required",
      400,
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedSub = await repo.incrementApproachUsage(
        tx,
        activeSub.id,
        activeSub.approachesAllowed,
      );

      if (updatedSub.count === 0) {
        throw new InterestServiceError(
          "LIMIT_REACHED",
          "Subscription approaches limit reached. Upgrade required.",
          403,
        );
      }

      const interestRequest = await repo.createInterestRequest(tx, {
        tenantId: tenant.id,
        ownerId: property.ownerId,
        propertyId: property.id,
        tenantMessage: trimmedMessage,
        profileSnapshot,
        propertySnapshot,
      });

      await repo.createInquiryAuditLog(tx, {
        inquiryId: interestRequest.id,
        actorId: tenant.id,
        actorRole: tenant.role,
        action: "CREATED",
        metadata: {
          propertyId: property.id,
          ownerId: property.ownerId,
        },
      });

      const notification = await createNotification(
        {
          userId: property.ownerId,
          title: "New tenant inquiry",
          message: `${profileSnapshot.tenantName || "A verified tenant"} sent an inquiry for ${propertySnapshot.title}.`,
          type: "INQUIRY_CREATED",
          relatedId: interestRequest.id,
          relatedType: "Inquiry",
        },
        { prisma: tx, enqueue: false },
      );

      return { interestRequest, notification };
    });

    enqueueInterestNotification(
      result.notification,
      [property.ownerId],
      "interest request creation",
    );

    return {
      interestRequest: result.interestRequest,
      chatRoom: null,
      chatMessage: null,
    };
  } catch (error) {
    if (error instanceof InterestServiceError) {
      throw error;
    }

    if (
      error.code === "P2002" ||
      String(error.message || "").includes("inquiries_tenant_property_unique_idx")
    ) {
      throw new InterestServiceError(
        "INQUIRY_EXISTS",
        "An inquiry already exists for this property",
        409,
      );
    }

    throw error;
  }
}

async function getPendingInterestRequests({ owner, page, limit }) {
  if (owner.role !== "OWNER") {
    throw new InterestServiceError(
      "ROLE_NOT_ALLOWED",
      "Only owners can view pending interest requests",
      403,
    );
  }

  const [total, requests] = await repo.findPendingByOwner(prisma, {
    ownerId: owner.id,
    page,
    limit,
  });

  return {
    requests,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function getInterestRequest({ user, interestRequestId }) {
  const interestRequest = await repo.findInterestRequestById(prisma, interestRequestId);
  if (!interestRequest) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  if (interestRequest.tenantId !== user.id && interestRequest.ownerId !== user.id) {
    throw new InterestServiceError(
      "FORBIDDEN",
      "You cannot view this inquiry",
      403,
    );
  }

  if (
    (interestRequest.tenantId === user.id && interestRequest.tenantDeletedAt) ||
    (interestRequest.ownerId === user.id && interestRequest.ownerDeletedAt)
  ) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  return interestRequest;
}

async function deleteInterestRequestHistory({ user, interestRequestId }) {
  const interestRequest = await repo.findInterestRequestById(prisma, interestRequestId);
  if (!interestRequest) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  if (interestRequest.tenantId !== user.id && interestRequest.ownerId !== user.id) {
    throw new InterestServiceError(
      "FORBIDDEN",
      "You cannot delete this inquiry",
      403,
    );
  }

  const participantRole = interestRequest.tenantId === user.id ? "TENANT" : "OWNER";
  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await repo.markDeletedForParticipant(tx, {
      id: interestRequestId,
      userId: user.id,
      role: participantRole,
    });

    if (updateResult.count === 0) {
      throw new InterestServiceError(
        "INTEREST_REQUEST_NOT_FOUND",
        "Interest request not found",
        404,
      );
    }

    await repo.createInquiryAuditLog(tx, {
      inquiryId: interestRequestId,
      actorId: user.id,
      actorRole: user.role,
      action: "DELETED_FROM_HISTORY",
      metadata: { deletedFor: participantRole },
    });

    return updateResult;
  });

  if (result.count === 0) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  return { deleted: true };
}

function buildDecisionMessage(status, interestRequest, ownerMessage) {
  const propertyName =
    interestRequest.propertySnapshot?.title ||
    interestRequest.property?.title ||
    "the property";

  if (status === "ACCEPTED") {
    const lines = [
      `Great news! The owner of ${propertyName} would like to talk with you.`,
    ];

    if (ownerMessage) {
      lines.push(`They said: ${ownerMessage}`);
    }

    lines.push("You can now message them directly.");
    return lines.join(" ");
  }

  return `Thank you for your interest in ${propertyName}. Unfortunately, the owner is not available to discuss at this time. We hope you find the perfect property!`;
}

async function decideInterestRequest({ owner, interestRequestId, status, ownerMessage }) {
  if (owner.role !== "OWNER") {
    throw new InterestServiceError(
      "ROLE_NOT_ALLOWED",
      "Only owners can manage interest requests",
      403,
    );
  }

  const existing = await repo.findInterestRequestById(prisma, interestRequestId);
  if (!existing) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  if (existing.ownerId !== owner.id) {
    throw new InterestServiceError(
      "NOT_PROPERTY_OWNER",
      "Only the property owner can manage this inquiry",
      403,
    );
  }

  if (existing.ownerDeletedAt) {
    throw new InterestServiceError(
      "INTEREST_REQUEST_NOT_FOUND",
      "Interest request not found",
      404,
    );
  }

  const trimmedOwnerMessage = typeof ownerMessage === "string" ? sanitizePlainText(ownerMessage) : "";
  let result;

  try {
    result = await prisma.$transaction(async (tx) => {
      const interestRequest = await repo.updateInterestStatus(tx, {
        id: interestRequestId,
        status,
        ownerMessage: trimmedOwnerMessage || null,
        expectedStatus: "PENDING",
      });

      let chatRoom = null;
      const chatMessages = [];

      if (status === "ACCEPTED") {
        chatRoom = await repo.findOrCreateChatRoom(tx, {
          tenantId: interestRequest.tenantId,
          ownerId: interestRequest.ownerId,
          listingId: interestRequest.propertyId,
        });

        chatMessages.push(await repo.createInterestChatMessage(tx, {
          roomId: chatRoom.id,
          senderId: interestRequest.tenantId,
          content: buildInterestMessageContent(
            interestRequest.profileSnapshot,
            interestRequest.propertySnapshot,
            interestRequest.tenantMessage,
          ),
          messageType: "INTEREST_REQUEST",
          metadata: {
            interestRequestId: interestRequest.id,
            tenant: interestRequest.profileSnapshot,
            property: interestRequest.propertySnapshot,
            message: interestRequest.tenantMessage,
          },
        }));

        chatMessages.push(await repo.createInterestChatMessage(tx, {
          roomId: chatRoom.id,
          senderId: owner.id,
          content: buildDecisionMessage(status, interestRequest, trimmedOwnerMessage),
          messageType: "TEXT",
          metadata: {
            automated: true,
            interestRequestId: interestRequest.id,
            action: status,
            ownerMessage: trimmedOwnerMessage || null,
          },
        }));
      }

      const notificationType =
        status === "ACCEPTED" ? "INQUIRY_ACCEPTED" : "INQUIRY_REJECTED";
      const notification = await createNotification(
        {
          userId: interestRequest.tenantId,
          title:
            status === "ACCEPTED" ? "Inquiry accepted" : "Inquiry declined",
          message: buildDecisionMessage(status, interestRequest, trimmedOwnerMessage),
          type: notificationType,
          relatedId: interestRequest.id,
          relatedType: "Inquiry",
        },
        { prisma: tx, enqueue: false },
      );

      await repo.createInquiryAuditLog(tx, {
        inquiryId: interestRequest.id,
        actorId: owner.id,
        actorRole: owner.role,
        action: status === "ACCEPTED" ? "ACCEPTED" : "DECLINED",
        metadata: {
          ownerMessage: trimmedOwnerMessage || null,
          previousStatus: "PENDING",
          status,
        },
      });

      return { interestRequest, chatRoom, chatMessages, notification };
    });
  } catch (error) {
    if (error.code === "P2025") {
      throw new InterestServiceError(
        "INTEREST_REQUEST_ALREADY_RESOLVED",
        "Interest request has already been resolved",
        409,
      );
    }
    throw error;
  }

  enqueueInterestNotification(
    result.notification,
    [result.interestRequest.tenantId],
    "interest decision",
  );

  return {
    interestRequest: result.interestRequest,
    chatRoom: result.chatRoom,
    chatMessages: result.chatMessages,
    chatMessage: result.chatMessages[result.chatMessages.length - 1] || null,
  };
}

function acceptInterestRequest({ owner, interestRequestId, ownerMessage }) {
  return decideInterestRequest({
    owner,
    interestRequestId,
    status: "ACCEPTED",
    ownerMessage,
  });
}

function rejectInterestRequest({ owner, interestRequestId, ownerMessage }) {
  return decideInterestRequest({
    owner,
    interestRequestId,
    status: "REJECTED",
    ownerMessage,
  });
}

function respondToInterestRequest({ owner, interestRequestId, action, ownerMessage }) {
  const statusByAction = {
    ACCEPT: "ACCEPTED",
    DECLINE: "REJECTED",
  };
  const status = statusByAction[action];

  if (!status) {
    throw new InterestServiceError("INVALID_ACTION", "Unsupported action", 400);
  }

  return decideInterestRequest({
    owner,
    interestRequestId,
    status,
    ownerMessage,
  });
}

module.exports = {
  InterestServiceError,
  createInterestRequest,
  getPendingInterestRequests,
  getInterestRequest,
  deleteInterestRequestHistory,
  acceptInterestRequest,
  rejectInterestRequest,
  respondToInterestRequest,
};

