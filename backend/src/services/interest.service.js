const { prisma } = require("../config/db");
const repo = require("../repositories/interest.repository");
const {
  createNotification,
  enqueueNotificationJob,
} = require("./notification.service");

class InterestServiceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "InterestServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
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

  if (message) {
    lines.push(`Message: ${message}`);
  }

  return lines.join("\n");
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

  const existingPending = await repo.findPendingByTenantAndProperty(
    prisma,
    tenant.id,
    propertyId,
  );
  if (existingPending) {
    throw new InterestServiceError(
      "PENDING_INTEREST_EXISTS",
      "A pending interest request already exists for this property",
      409,
    );
  }

  const profileSnapshot = buildProfileSnapshot(tenant);
  const propertySnapshot = buildPropertySnapshot(property);
  const trimmedMessage = typeof message === "string" ? message.trim() : "";

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
        profileSnapshot,
        propertySnapshot,
      });

      const chatRoom = await repo.findOrCreateChatRoom(tx, {
        tenantId: tenant.id,
        ownerId: property.ownerId,
        listingId: property.id,
      });

      const chatMessage = await repo.createInterestChatMessage(tx, {
        roomId: chatRoom.id,
        senderId: tenant.id,
        content: buildInterestMessageContent(
          profileSnapshot,
          propertySnapshot,
          trimmedMessage,
        ),
        messageType: "INTEREST_REQUEST",
        metadata: {
          interestRequestId: interestRequest.id,
          tenant: profileSnapshot,
          property: propertySnapshot,
          message: trimmedMessage || null,
        },
      });

      const notification = await createNotification(
        {
          userId: property.ownerId,
          title: "New tenant interest request",
          message: `${profileSnapshot.tenantName || "A verified tenant"} is interested in ${propertySnapshot.title}.`,
          type: "INTEREST_REQUEST",
          relatedId: interestRequest.id,
          relatedType: "InterestRequest",
        },
        { prisma: tx, enqueue: false },
      );

      return { interestRequest, chatRoom, chatMessage, notification };
    });

    try {
      void enqueueNotificationJob({
        notificationId: result.notification.id,
        userIds: [property.ownerId],
        title: result.notification.title,
        message: result.notification.message,
        type: result.notification.type,
        relatedId: result.notification.relatedId,
        relatedType: result.notification.relatedType,
      }).catch((enqueueError) => {
        console.error(
          "Failed to enqueue notification after interest request creation:",
          enqueueError,
        );
      });
    } catch (enqueueError) {
      console.error(
        "Failed to enqueue notification after interest request creation:",
        enqueueError,
      );
    }

    return result;
  } catch (error) {
    if (error instanceof InterestServiceError) {
      throw error;
    }

    if (
      error.code === "P2002" ||
      String(error.message || "").includes("interest_requests_pending_unique_idx")
    ) {
      throw new InterestServiceError(
        "PENDING_INTEREST_EXISTS",
        "A pending interest request already exists for this property",
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

function buildDecisionMessage(status, interestRequest) {
  const propertyName =
    interestRequest.propertySnapshot?.title ||
    interestRequest.property?.title ||
    "the property";

  if (status === "ACCEPTED") {
    return `Your inquiry for ${propertyName} has been accepted.`;
  }

  return `Your inquiry for ${propertyName} has been rejected.`;
}

async function decideInterestRequest({ owner, interestRequestId, status }) {
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

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const interestRequest = await repo.updateInterestStatus(tx, {
        id: interestRequestId,
        status,
        expectedStatus: "PENDING",
      });

      const chatRoom = await repo.findOrCreateChatRoom(tx, {
        tenantId: interestRequest.tenantId,
        ownerId: interestRequest.ownerId,
        listingId: interestRequest.propertyId,
      });

      const chatMessage = await repo.createInterestChatMessage(tx, {
        roomId: chatRoom.id,
        senderId: owner.id,
        content: buildDecisionMessage(status, interestRequest),
        messageType: "TEXT",
        metadata: {
          automated: true,
          interestRequestId: interestRequest.id,
          action: status,
        },
      });

      const notificationType =
        status === "ACCEPTED" ? "INQUIRY_ACCEPTED" : "INQUIRY_REJECTED";
      const notification = await createNotification(
        {
          userId: interestRequest.tenantId,
          title:
            status === "ACCEPTED" ? "Inquiry accepted" : "Inquiry rejected",
          message: buildDecisionMessage(status, interestRequest),
          type: notificationType,
          relatedId: interestRequest.id,
          relatedType: "InterestRequest",
        },
        { prisma: tx, enqueue: false },
      );

      return { interestRequest, chatRoom, chatMessage, notification };
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

  try {
    void enqueueNotificationJob({
      notificationId: result.notification.id,
      userIds: [result.interestRequest.tenantId],
      title: result.notification.title,
      message: result.notification.message,
      type: result.notification.type,
      relatedId: result.notification.relatedId,
      relatedType: result.notification.relatedType,
    }).catch((enqueueError) => {
      console.error(
        "Failed to enqueue notification after interest decision:",
        enqueueError,
      );
    });
  } catch (enqueueError) {
    console.error(
      "Failed to enqueue notification after interest decision:",
      enqueueError,
    );
  }

  return result;
}

function acceptInterestRequest({ owner, interestRequestId }) {
  return decideInterestRequest({ owner, interestRequestId, status: "ACCEPTED" });
}

function rejectInterestRequest({ owner, interestRequestId }) {
  return decideInterestRequest({ owner, interestRequestId, status: "REJECTED" });
}

module.exports = {
  InterestServiceError,
  createInterestRequest,
  getPendingInterestRequests,
  acceptInterestRequest,
  rejectInterestRequest,
};
