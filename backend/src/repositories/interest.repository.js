const INTEREST_INCLUDE = {
  tenant: {
    select: {
      id: true,
      fullName: true,
      verificationStatus: true,
      currentCountry: true,
      destinationCountry: true,
      currentStatus: true,
      visaStatus: true,
      visaType: true,
      plannedMoveDate: true,
      purposeOfRelocation: true,
      expectedRentalDuration: true,
      residencyStatus: true,
      isUrgentMatch: true,
    },
  },
  owner: { select: { id: true, fullName: true } },
  property: {
    select: {
      id: true,
      title: true,
      rent: true,
      location: true,
      city: true,
      bedrooms: true,
      bathrooms: true,
      availabilityDate: true,
      status: true,
    },
  },
};

function findPropertyById(prisma, propertyId) {
  return prisma.listing.findUnique({
    where: { id: propertyId },
    include: { owner: true },
  });
}

function findActiveByTenantAndProperty(prisma, tenantId, propertyId) {
  return prisma.inquiry.findFirst({
    where: { tenantId, propertyId, tenantDeletedAt: null },
  });
}

function findPendingByOwner(prisma, { ownerId, page, limit }) {
  const where = { ownerId, status: "PENDING", ownerDeletedAt: null };
  const skip = (page - 1) * limit;

  return Promise.all([
    prisma.inquiry.count({ where }),
    prisma.inquiry.findMany({
      where,
      include: INTEREST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

function findInterestRequestById(prisma, id) {
  return prisma.inquiry.findUnique({
    where: { id },
    include: INTEREST_INCLUDE,
  });
}

function countTenantRequestsSince(prisma, { tenantId, since }) {
  return prisma.inquiry.count({
    where: {
      tenantId,
      createdAt: { gte: since },
    },
  });
}

function markDeletedForParticipant(prisma, { id, userId, role }) {
  const isTenant = role === "TENANT";
  return prisma.inquiry.updateMany({
    where: {
      id,
      ...(isTenant ? { tenantId: userId } : { ownerId: userId }),
    },
    data: isTenant
      ? { tenantDeletedAt: new Date() }
      : { ownerDeletedAt: new Date() },
  });
}
function createInquiryAuditLog(prisma, data) {
  return prisma.inquiryAuditLog.create({
    data: {
      inquiryId: data.inquiryId,
      actorId: data.actorId || null,
      actorRole: data.actorRole || null,
      action: data.action,
      metadata: data.metadata || undefined,
    },
  });
}
function findActiveSubscription(prisma, userId) {
  return prisma.subscription.findFirst({
    where: {
      userId,
      isActive: true,
      endDate: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      isActive: true,
      endDate: true,
      approachesAllowed: true,
      approachesUsed: true,
    },
  });
}

function createInterestRequest(prisma, data) {
  return prisma.inquiry.create({
    data,
    include: INTEREST_INCLUDE,
  });
}

function findOrCreateChatRoom(prisma, { tenantId, ownerId, listingId }) {
  return prisma.chatRoom.upsert({
    where: {
      tenantId_ownerId_listingId: {
        tenantId,
        ownerId,
        listingId,
      },
    },
    update: {},
    create: {
      tenantId,
      ownerId,
      listingId,
    },
  });
}

function createInterestChatMessage(prisma, data) {
  return prisma.chatMessage.create({
    data,
    include: { sender: { select: { id: true, fullName: true } } },
  });
}

function updateInterestStatus(prisma, { id, status, ownerMessage, expectedStatus = "PENDING" }) {
  return prisma.inquiry.update({
    where: { id, status: expectedStatus },
    data: {
      status,
      ownerMessage: ownerMessage || null,
      respondedAt: new Date(),
    },
    include: INTEREST_INCLUDE,
  });
}

function incrementApproachUsage(prisma, subscriptionId, approachesAllowed) {
  return prisma.subscription.updateMany({
    where: {
      id: subscriptionId,
      isActive: true,
      endDate: { gte: new Date() },
      OR: [
        { approachesAllowed: -1 },
        { approachesUsed: { lt: approachesAllowed } },
      ],
    },
    data: { approachesUsed: { increment: 1 } },
  });
}

module.exports = {
  findPropertyById,
  findActiveByTenantAndProperty,
  findPendingByOwner,
  findInterestRequestById,
  countTenantRequestsSince,
  markDeletedForParticipant,
  createInquiryAuditLog,
  findActiveSubscription,
  createInterestRequest,
  findOrCreateChatRoom,
  createInterestChatMessage,
  updateInterestStatus,
  incrementApproachUsage,
};

