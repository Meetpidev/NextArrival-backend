const INTEREST_INCLUDE = {
  tenant: {
    select: {
      id: true,
      fullName: true,
      email: true,
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
  owner: { select: { id: true, fullName: true, email: true } },
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

function findPendingByTenantAndProperty(prisma, tenantId, propertyId) {
  return prisma.interestRequest.findFirst({
    where: { tenantId, propertyId, status: "PENDING" },
  });
}

function findPendingByOwner(prisma, { ownerId, page, limit }) {
  const where = { ownerId, status: "PENDING" };
  const skip = (page - 1) * limit;

  return Promise.all([
    prisma.interestRequest.count({ where }),
    prisma.interestRequest.findMany({
      where,
      include: INTEREST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

function findInterestRequestById(prisma, id) {
  return prisma.interestRequest.findUnique({
    where: { id },
    include: INTEREST_INCLUDE,
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
  return prisma.interestRequest.create({
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

function updateInterestStatus(prisma, { id, status, expectedStatus = "PENDING" }) {
  return prisma.interestRequest.update({
    where: { id, status: expectedStatus },
    data: { status },
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
  findPendingByTenantAndProperty,
  findPendingByOwner,
  findInterestRequestById,
  findActiveSubscription,
  createInterestRequest,
  findOrCreateChatRoom,
  createInterestChatMessage,
  updateInterestStatus,
  incrementApproachUsage,
};
