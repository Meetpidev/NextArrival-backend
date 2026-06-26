require("dotenv/config");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { env } = require("../src/config/env");
const { childLogger } = require("../src/config/logger");

const logger = childLogger("seed-dummy-data");
const TEST_PASSWORD = "NestArrivalTest2026!";
const OTP_CODE = "123456";

function resolveDatabaseUrl(connectionString) {
  if (!connectionString) {
    logger.error("DATABASE_URL is not defined in backend .env");
    process.exit(1);
  }

  if (!connectionString.startsWith("prisma+postgres://")) {
    return connectionString;
  }

  try {
    const urlObj = new URL(connectionString);
    const apiKey = urlObj.searchParams.get("api_key");
    if (!apiKey) return connectionString;

    const decoded = Buffer.from(apiKey, "base64").toString("utf-8");
    const json = JSON.parse(decoded);
    return json.databaseUrl || connectionString;
  } catch (err) {
    logger.error({ err }, "Failed to parse database URL");
    return connectionString;
  }
}

const pool = new Pool({
  connectionString: resolveDatabaseUrl(env.databaseUrl),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function upsertUserByEmail(email, data) {
  return prisma.user.upsert({
    where: { email },
    update: data,
    create: { email, ...data },
  });
}

async function findOrCreateListing(ownerId, data) {
  const existing = await prisma.listing.findFirst({
    where: { ownerId, title: data.title },
  });

  if (existing) return existing;

  const listing = await prisma.listing.create({
    data: { ownerId, ...data },
  });
  logger.info({ title: data.title }, "Dummy listing created");
  return listing;
}

async function findOrCreateSubscription(userId, data) {
  const existing = await prisma.subscription.findFirst({
    where: { userId, planId: data.planId, status: data.status },
  });

  if (existing) return existing;
  return prisma.subscription.create({ data: { userId, ...data } });
}

async function findOrCreateSavedListing(userId, listingId) {
  return prisma.savedListing.upsert({
    where: { userId_listingId: { userId, listingId } },
    update: {},
    create: { userId, listingId },
  });
}

async function findOrCreateApproach({ tenantId, ownerId, listingId }) {
  return prisma.approach.upsert({
    where: { tenantId_listingId: { tenantId, listingId } },
    update: { ownerId },
    create: { tenantId, ownerId, listingId },
  });
}

function userSnapshot(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    verificationStatus: user.verificationStatus,
    currentCountry: user.currentCountry,
    destinationCountry: user.destinationCountry,
    visaStatus: user.visaStatus,
    visaType: user.visaType,
    plannedMoveDate: user.plannedMoveDate,
    purposeOfRelocation: user.purposeOfRelocation,
    expectedRentalDuration: user.expectedRentalDuration,
    residencyStatus: user.residencyStatus,
    isUrgentMatch: user.isUrgentMatch,
  };
}

function listingSnapshot(listing) {
  return {
    id: listing.id,
    title: listing.title,
    rent: listing.rent,
    city: listing.city,
    location: listing.location,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    status: listing.status,
  };
}

async function findOrCreateInquiry({ tenant, owner, listing, tenantMessage, status, ownerMessage, respondedAt }) {
  const existing = await prisma.inquiry.findFirst({
    where: { tenantId: tenant.id, propertyId: listing.id },
  });

  if (existing) return existing;

  const inquiry = await prisma.inquiry.create({
    data: {
      tenantId: tenant.id,
      ownerId: owner.id,
      propertyId: listing.id,
      tenantMessage,
      status,
      ownerMessage,
      respondedAt,
      profileSnapshot: userSnapshot(tenant),
      propertySnapshot: listingSnapshot(listing),
    },
  });

  await createInquiryAuditIfMissing({
    inquiryId: inquiry.id,
    actorId: tenant.id,
    actorRole: tenant.role,
    action: "CREATED",
    metadata: { tenantMessage },
  });

  if (status === "ACCEPTED") {
    await createInquiryAuditIfMissing({
      inquiryId: inquiry.id,
      actorId: owner.id,
      actorRole: owner.role,
      action: "ACCEPTED",
      metadata: { ownerMessage },
    });
  }

  if (status === "REJECTED") {
    await createInquiryAuditIfMissing({
      inquiryId: inquiry.id,
      actorId: owner.id,
      actorRole: owner.role,
      action: "DECLINED",
      metadata: { ownerMessage },
    });
  }

  return inquiry;
}

async function createInquiryAuditIfMissing({ inquiryId, actorId, actorRole, action, metadata }) {
  const existing = await prisma.inquiryAuditLog.findFirst({
    where: { inquiryId, actorId, action },
  });

  if (existing) return existing;
  return prisma.inquiryAuditLog.create({
    data: { inquiryId, actorId, actorRole, action, metadata },
  });
}

async function findOrCreateChatRoom({ tenantId, ownerId, listingId }) {
  return prisma.chatRoom.upsert({
    where: {
      tenantId_ownerId_listingId: { tenantId, ownerId, listingId },
    },
    update: {},
    create: { tenantId, ownerId, listingId },
  });
}

async function createChatMessageIfMissing({ roomId, senderId, content, messageType = "TEXT", metadata, createdAt }) {
  const existing = await prisma.chatMessage.findFirst({
    where: { roomId, senderId, content },
  });

  if (existing) return existing;
  return prisma.chatMessage.create({
    data: {
      roomId,
      senderId,
      content,
      messageType,
      metadata,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function createNotificationIfMissing({ userId, title, message, type, relatedId, relatedType, isRead = false, createdAt }) {
  const existing = await prisma.notification.findFirst({
    where: { userId, title, message, type, relatedId: relatedId || null },
  });

  if (existing) return existing;
  return prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      relatedId: relatedId || null,
      relatedType: relatedType || null,
      isRead,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

async function createRefundRequestIfMissing({ userId, subscriptionId, reason, status, adminNotes }) {
  const existing = await prisma.refundRequest.findFirst({
    where: { userId, subscriptionId, reason },
  });

  if (existing) return existing;
  return prisma.refundRequest.create({
    data: { userId, subscriptionId, reason, status, adminNotes },
  });
}

async function createContactIfMissing(data) {
  const existing = await prisma.contactUs.findFirst({
    where: { email: data.email, subject: data.subject },
  });

  if (existing) return existing;
  return prisma.contactUs.create({ data });
}

async function createPartnerInquiryIfMissing(data) {
  const existing = await prisma.partnerInquiry.findFirst({
    where: { email: data.email, organizationName: data.organizationName },
  });

  if (existing) return existing;
  return prisma.partnerInquiry.create({ data });
}

async function seedUsers(passwordHash) {
  const admin = await upsertUserByEmail("admin@nestarrival.ca", {
    passwordHash,
    fullName: "NestArrival Admin",
    role: "ADMIN",
    isVerified: true,
    verificationStatus: "VERIFIED",
  });

  const ownerDavid = await upsertUserByEmail("david.owner@nestarrival.ca", {
    passwordHash,
    fullName: "David Chen",
    role: "OWNER",
    isVerified: true,
    verificationStatus: "VERIFIED",
    residencyStatus: "Canadian Citizen",
  });

  const ownerSarah = await upsertUserByEmail("sarah.landlord@nestarrival.ca", {
    passwordHash,
    fullName: "Sarah Mitchell",
    role: "OWNER",
    isVerified: true,
    verificationStatus: "VERIFIED",
    residencyStatus: "Permanent Resident",
  });

  const ownerMarcus = await upsertUserByEmail("owner_test@nestarrival.ca", {
    passwordHash,
    role: "OWNER",
    fullName: "Marcus Landlord",
    isVerified: true,
    verificationStatus: "VERIFIED",
    residencyStatus: "Canadian Citizen",
  });

  const tenantArjun = await upsertUserByEmail("arjun.tenant@nestarrival.ca", {
    passwordHash,
    fullName: "Arjun Sharma",
    role: "TENANT",
    isVerified: true,
    verificationStatus: "VERIFIED",
    currentCountry: "India",
    destinationCountry: "Canada",
    visaStatus: "Approved",
    visaType: "Student Visa",
    plannedMoveDate: "2026-09-01",
    purposeOfRelocation: "Studies at UofT",
    expectedRentalDuration: "1 Year",
    residencyStatus: "International Student",
  });

  const tenantMaria = await upsertUserByEmail("maria.tenant@nestarrival.ca", {
    passwordHash,
    fullName: "Maria Gonzalez",
    role: "TENANT",
    isVerified: true,
    verificationStatus: "PENDING_VERIFICATION",
    currentCountry: "Mexico",
    destinationCountry: "Canada",
    visaStatus: "Approved",
    visaType: "Work Permit",
    plannedMoveDate: "2026-10-15",
    purposeOfRelocation: "Tech Job Transfer",
    expectedRentalDuration: "2 Years",
    residencyStatus: "Temporary Worker",
  });

  const tenantRishabh = await upsertUserByEmail("tenant_test@nestarrival.ca", {
    passwordHash,
    role: "TENANT",
    fullName: "Rishabh Newcomer",
    isVerified: true,
    verificationStatus: "VERIFIED",
    currentCountry: "India",
    destinationCountry: "Canada",
    purposeOfRelocation: "University Studies",
    visaStatus: "Valid Visa Available",
    visaType: "Study Permit",
    plannedMoveDate: "1-3 Months",
    expectedRentalDuration: "1 Year",
    residencyStatus: "International Student",
    isUrgentMatch: true,
    urgentMatchRequestedAt: daysAgo(2),
  });

  const tenantPending = await prisma.pendingUser.upsert({
    where: { email: "pending.tenant@nestarrival.ca" },
    update: {
      passwordHash,
      fullName: "Pending Tenant",
      role: "TENANT",
      otp: await bcrypt.hash(OTP_CODE, 10),
      otpExpiry: daysFromNow(1),
      otpAttempts: 0,
      otpLastSentAt: new Date(),
    },
    create: {
      email: "pending.tenant@nestarrival.ca",
      passwordHash,
      fullName: "Pending Tenant",
      role: "TENANT",
      otp: await bcrypt.hash(OTP_CODE, 10),
      otpExpiry: daysFromNow(1),
      otpAttempts: 0,
      otpLastSentAt: new Date(),
    },
  });

  return {
    admin,
    owners: { ownerDavid, ownerSarah, ownerMarcus },
    tenants: { tenantArjun, tenantMaria, tenantRishabh },
    tenantPending,
  };
}

async function seedListings(users) {
  const { ownerDavid, ownerSarah, ownerMarcus } = users.owners;

  const listingToronto = await findOrCreateListing(ownerDavid.id, {
    title: "Cozy Shared Student Unit near UofT",
    description:
      "A beautiful, sunlit room in a shared 3-bedroom apartment. Perfect for international students. Five minutes walk from St. George Station.",
    rent: 850,
    location: "Bloor St W & Spadina Ave",
    city: "Toronto",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: daysFromNow(20),
    photos: ["/images/toronto_loft.png"],
    status: "APPROVED",
  });

  const listingVancouver = await findOrCreateListing(ownerSarah.id, {
    title: "Modern Downtown Suite in Tech District",
    description:
      "A stunning 1-bedroom suite in the heart of Vancouver's tech district with balcony, in-suite laundry, and gym access.",
    rent: 1950,
    location: "Yaletown",
    city: "Vancouver",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: daysFromNow(35),
    photos: ["/images/vancouver_townhouse.png"],
    status: "APPROVED",
  });

  const listingMontreal = await findOrCreateListing(ownerDavid.id, {
    title: "Newcomer Co-Living Condo",
    description:
      "Affordable shared accommodation for newcomers. Fully furnished with high-speed internet included and transit nearby.",
    rent: 750,
    location: "Downtown",
    city: "Montreal",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: daysFromNow(12),
    photos: ["/images/montreal_studio.png"],
    status: "APPROVED",
  });

  const listingPremium = await findOrCreateListing(ownerMarcus.id, {
    title: "Premium 2-Bed High-Rise Condo Downtown",
    description:
      "Beautiful modern condo located in core downtown Toronto. Rent includes utility fees, secure underground parking, in-suite laundry, and fast internet access.",
    rent: 2450,
    location: "450 Yonge St, Toronto, ON",
    city: "Toronto",
    bedrooms: 2,
    bathrooms: 2,
    availabilityDate: daysFromNow(14),
    photos: [],
    status: "APPROVED",
  });

  const listingPending = await findOrCreateListing(ownerMarcus.id, {
    title: "Spacious Student Townhouse Near Campus",
    description:
      "Cozy furnished room blocks from university grounds. Features shared kitchen, living spaces, heating, AC, and outdoor patio deck.",
    rent: 1100,
    location: "2580 Wesbrook Mall, Vancouver, BC",
    city: "Vancouver",
    bedrooms: 4,
    bathrooms: 3,
    availabilityDate: daysFromNow(25),
    photos: [],
    status: "PENDING_REVIEW",
  });

  const listingRejected = await findOrCreateListing(ownerMarcus.id, {
    title: "Cozy Garden Suite in Quiet Suburb",
    description:
      "Private 1-bedroom garden basement suite in a family neighborhood with independent entry, full bath, kitchen appliances, and washer dryer.",
    rent: 1400,
    location: "123 Panorama Hills Rd NW, Calgary, AB",
    city: "Calgary",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: daysFromNow(40),
    photos: [],
    status: "REJECTED",
    adminFeedback: "Please add clearer photos before resubmitting.",
  });

  return {
    listingToronto,
    listingVancouver,
    listingMontreal,
    listingPremium,
    listingPending,
    listingRejected,
  };
}

async function seedSubscriptionsAndRefunds(users) {
  const { tenantArjun, tenantMaria, tenantRishabh } = users.tenants;

  const active = await findOrCreateSubscription(tenantRishabh.id, {
    planId: "plan-featured",
    name: "Featured Elite",
    price: 188,
    durationDays: 60,
    isSubscription: true,
    approachesAllowed: -1,
    approachesUsed: 2,
    startDate: daysAgo(2),
    endDate: daysFromNow(58),
    isActive: true,
    status: "ACTIVE",
  });

  const arjunActive = await findOrCreateSubscription(tenantArjun.id, {
    planId: "plan-starter-active",
    name: "Starter Active",
    price: 49,
    durationDays: 30,
    isSubscription: false,
    approachesAllowed: 10,
    approachesUsed: 1,
    startDate: daysAgo(1),
    endDate: daysFromNow(29),
    isActive: true,
    status: "ACTIVE",
  });

  const pending = await findOrCreateSubscription(tenantArjun.id, {
    planId: "plan-basic-30",
    name: "Basic 30 Days",
    price: 49,
    durationDays: 30,
    isSubscription: false,
    approachesAllowed: 10,
    approachesUsed: 0,
    startDate: new Date(),
    endDate: daysFromNow(30),
    isActive: false,
    status: "PENDING",
  });

  const mariaActive = await findOrCreateSubscription(tenantMaria.id, {
    planId: "plan-worker-active",
    name: "Worker Active",
    price: 79,
    durationDays: 30,
    isSubscription: false,
    approachesAllowed: 12,
    approachesUsed: 1,
    startDate: daysAgo(3),
    endDate: daysFromNow(27),
    isActive: true,
    status: "ACTIVE",
  });

  const cancelled = await findOrCreateSubscription(tenantMaria.id, {
    planId: "plan-relocation-plus",
    name: "Relocation Plus",
    price: 99,
    durationDays: 30,
    isSubscription: true,
    approachesAllowed: 20,
    approachesUsed: 3,
    startDate: daysAgo(20),
    endDate: daysFromNow(10),
    isActive: false,
    status: "CANCELLED",
  });

  await createRefundRequestIfMissing({
    userId: tenantMaria.id,
    subscriptionId: cancelled.id,
    reason: "I found housing through another channel and no longer need the plan.",
    status: "PENDING",
    adminNotes: null,
  });

  return { active, arjunActive, mariaActive, pending, cancelled };
}

async function seedVerification(users) {
  const { tenantMaria } = users.tenants;

  await prisma.verificationRequest.upsert({
    where: { userId: tenantMaria.id },
    update: {
      residencyStatus: "Temporary Worker",
      documentUrls: ["/api/verification/files/dummy-maria-work-permit"],
      documentTypes: ["work_permit"],
      declarationsAccepted: true,
      adminNotes: null,
    },
    create: {
      userId: tenantMaria.id,
      residencyStatus: "Temporary Worker",
      documentUrls: ["/api/verification/files/dummy-maria-work-permit"],
      documentTypes: ["work_permit"],
      declarationsAccepted: true,
    },
  });
}

async function seedInquiriesChatsAndApproaches(users, listings) {
  const { ownerDavid, ownerSarah, ownerMarcus } = users.owners;
  const { tenantArjun, tenantMaria, tenantRishabh } = users.tenants;

  await findOrCreateSavedListing(tenantArjun.id, listings.listingToronto.id);
  await findOrCreateSavedListing(tenantArjun.id, listings.listingPremium.id);
  await findOrCreateSavedListing(tenantMaria.id, listings.listingVancouver.id);

  await findOrCreateApproach({
    tenantId: tenantRishabh.id,
    ownerId: ownerMarcus.id,
    listingId: listings.listingPremium.id,
  });

  await findOrCreateApproach({
    tenantId: tenantArjun.id,
    ownerId: ownerDavid.id,
    listingId: listings.listingToronto.id,
  });

  const inquiryAccepted = await findOrCreateInquiry({
    tenant: tenantArjun,
    owner: ownerDavid,
    listing: listings.listingToronto,
    tenantMessage:
      "Hi David, I am an international student from India moving to Toronto this Fall. Is this room still available?",
    status: "ACCEPTED",
    ownerMessage: "Yes, it is available. Let's schedule a video tour.",
    respondedAt: daysAgo(1),
  });

  const inquiryPending = await findOrCreateInquiry({
    tenant: tenantRishabh,
    owner: ownerMarcus,
    listing: listings.listingPremium,
    tenantMessage:
      "Hello Marcus, I am moving to Toronto next month on a Study Permit and I am interested in your Yonge St condo.",
    status: "PENDING",
  });

  const inquiryRejected = await findOrCreateInquiry({
    tenant: tenantMaria,
    owner: ownerSarah,
    listing: listings.listingVancouver,
    tenantMessage:
      "Hi Sarah, I am transferring to a tech firm in Yaletown next month. Is your suite open to short leases?",
    status: "REJECTED",
    ownerMessage: "Thanks Maria. This unit requires a 12-month lease, so it may not fit your timeline.",
    respondedAt: daysAgo(2),
  });

  const roomToronto = await findOrCreateChatRoom({
    tenantId: tenantArjun.id,
    ownerId: ownerDavid.id,
    listingId: listings.listingToronto.id,
  });

  await createChatMessageIfMissing({
    roomId: roomToronto.id,
    senderId: tenantArjun.id,
    content: inquiryAccepted.tenantMessage,
    messageType: "INTEREST_REQUEST",
    metadata: { inquiryId: inquiryAccepted.id },
    createdAt: daysAgo(3),
  });
  await createChatMessageIfMissing({
    roomId: roomToronto.id,
    senderId: ownerDavid.id,
    content:
      "Hello Arjun! Yes, it is still available. I see your visa is approved. When exactly are you planning to land?",
    createdAt: daysAgo(2),
  });
  await createChatMessageIfMissing({
    roomId: roomToronto.id,
    senderId: tenantArjun.id,
    content: "I land on August 20th. Can we arrange a video tour before I sign the lease?",
    createdAt: daysAgo(1),
  });
  await createChatMessageIfMissing({
    roomId: roomToronto.id,
    senderId: ownerDavid.id,
    content:
      "Absolutely. I will send you a Google Meet link for tomorrow and show the room plus shared kitchen.",
    createdAt: daysAgo(0.5),
  });

  const roomPremium = await findOrCreateChatRoom({
    tenantId: tenantRishabh.id,
    ownerId: ownerMarcus.id,
    listingId: listings.listingPremium.id,
  });

  await createChatMessageIfMissing({
    roomId: roomPremium.id,
    senderId: tenantRishabh.id,
    content: inquiryPending.tenantMessage,
    messageType: "INTEREST_REQUEST",
    metadata: { inquiryId: inquiryPending.id },
    createdAt: daysAgo(1),
  });
  await createChatMessageIfMissing({
    roomId: roomPremium.id,
    senderId: ownerMarcus.id,
    content:
      "Hi Rishabh, welcome to Canada. The condo is available from the first of next month. I can answer questions while I review your inquiry.",
    createdAt: daysAgo(0.25),
  });

  return { inquiryAccepted, inquiryPending, inquiryRejected, roomToronto, roomPremium };
}

async function seedNotifications(users, listings, scenario) {
  const { admin } = users;
  const { ownerDavid, ownerSarah, ownerMarcus } = users.owners;
  const { tenantArjun, tenantMaria, tenantRishabh } = users.tenants;

  await createNotificationIfMissing({
    userId: ownerDavid.id,
    title: "New inquiry received",
    message: "Arjun Sharma is interested in Cozy Shared Student Unit near UofT.",
    type: "INQUIRY_CREATED",
    relatedId: scenario.inquiryAccepted.id,
    relatedType: "Inquiry",
    isRead: true,
    createdAt: daysAgo(3),
  });

  await createNotificationIfMissing({
    userId: tenantArjun.id,
    title: "Inquiry accepted",
    message: "David Chen accepted your inquiry and opened a chat.",
    type: "INQUIRY_ACCEPTED",
    relatedId: scenario.inquiryAccepted.id,
    relatedType: "Inquiry",
    isRead: false,
    createdAt: daysAgo(1),
  });

  await createNotificationIfMissing({
    userId: ownerMarcus.id,
    title: "New inquiry received",
    message: "Rishabh Newcomer is interested in Premium 2-Bed High-Rise Condo Downtown.",
    type: "INQUIRY_CREATED",
    relatedId: scenario.inquiryPending.id,
    relatedType: "Inquiry",
    isRead: false,
    createdAt: daysAgo(1),
  });

  await createNotificationIfMissing({
    userId: tenantMaria.id,
    title: "Inquiry declined",
    message: "Sarah Mitchell declined your inquiry because the lease term does not match.",
    type: "INQUIRY_REJECTED",
    relatedId: scenario.inquiryRejected.id,
    relatedType: "Inquiry",
    isRead: false,
    createdAt: daysAgo(2),
  });

  await createNotificationIfMissing({
    userId: tenantArjun.id,
    title: "Owner replied to your chat",
    message: "David Chen: Absolutely. I will send you a Google Meet link for tomorrow.",
    type: "OWNER_RESPONSE",
    relatedId: scenario.roomToronto.id,
    relatedType: "ChatRoom",
    isRead: false,
    createdAt: daysAgo(0.5),
  });

  await createNotificationIfMissing({
    userId: ownerMarcus.id,
    title: "New chat message",
    message: "Rishabh Newcomer: Hello Marcus, I am moving to Toronto next month.",
    type: "CHAT_MESSAGE",
    relatedId: scenario.roomPremium.id,
    relatedType: "ChatRoom",
    isRead: false,
    createdAt: daysAgo(1),
  });

  await createNotificationIfMissing({
    userId: admin.id,
    title: "Listing waiting for review",
    message: `${listings.listingPending.title} is waiting for moderation.`,
    type: "SYSTEM",
    relatedId: listings.listingPending.id,
    relatedType: "Listing",
    isRead: false,
    createdAt: daysAgo(0.2),
  });

  await createNotificationIfMissing({
    userId: ownerSarah.id,
    title: "Partner request submitted",
    message: "A partner request was submitted and is waiting for admin review.",
    type: "PARTNER_REQUEST_SUBMITTED",
    relatedId: null,
    relatedType: "PartnerInquiry",
    isRead: true,
    createdAt: daysAgo(4),
  });
}

async function seedDeviceTokens(users) {
  const { tenantArjun, tenantRishabh } = users.tenants;

  await prisma.deviceToken.upsert({
    where: { token: "dummy-web-token-arjun" },
    update: { userId: tenantArjun.id, platform: "web", isActive: true },
    create: {
      userId: tenantArjun.id,
      token: "dummy-web-token-arjun",
      platform: "web",
      isActive: true,
    },
  });

  await prisma.deviceToken.upsert({
    where: { token: "dummy-expo-token-rishabh" },
    update: { userId: tenantRishabh.id, platform: "expo", isActive: true },
    create: {
      userId: tenantRishabh.id,
      token: "dummy-expo-token-rishabh",
      platform: "expo",
      isActive: true,
    },
  });
}

async function seedPublicInquiriesAndPartners() {
  await createContactIfMissing({
    whoAreYou: "Tenant",
    fullName: "Priya Kumar",
    email: "priya.contact@example.com",
    phone: "+14165550123",
    destinationCity: "Toronto",
    visaStatus: "Approved",
    subject: "Need help before arrival",
    messageDetail:
      "I am arriving in Toronto in six weeks and need help understanding which listings are suitable for students.",
    status: "PENDING",
  });

  await createContactIfMissing({
    whoAreYou: "Owner",
    fullName: "Linda Property Manager",
    email: "linda.manager@example.com",
    phone: "+16045550123",
    destinationCity: "Vancouver",
    visaStatus: "",
    subject: "Listing onboarding question",
    messageDetail:
      "I manage furnished rentals and would like to understand the document requirements for hosting newcomers.",
    status: "RESOLVED",
  });

  await createPartnerInquiryIfMissing({
    partnershipType: "Relocation agency",
    organizationName: "Maple Move Partners",
    fullName: "Ethan Brooks",
    email: "ethan@maplemove.example",
    phone: "+14165550999",
    country: "Canada",
    cityRegion: "Ontario",
    partnershipGoal: "Refer verified tenants",
    tellUsMore:
      "We support international students and workers moving to Ontario and want to refer qualified renters to NestArrival.",
    status: "ACCEPTED",
  });

  await createPartnerInquiryIfMissing({
    partnershipType: "University support office",
    organizationName: "Global Student Welcome Desk",
    fullName: "Nora Li",
    email: "nora@studentwelcome.example",
    phone: "+16475550111",
    country: "Canada",
    cityRegion: "British Columbia",
    partnershipGoal: "Housing support",
    tellUsMore:
      "Our office helps incoming international students find safe temporary and long-term housing.",
    status: "PENDING",
  });
}

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DUMMY_DATA_SEED !== "true"
  ) {
    throw new Error("Refusing to seed dummy data in production");
  }

  logger.info("Seeding dummy data started");

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const users = await seedUsers(passwordHash);
  const listings = await seedListings(users);
  await seedSubscriptionsAndRefunds(users);
  await seedVerification(users);
  const scenario = await seedInquiriesChatsAndApproaches(users, listings);
  await seedNotifications(users, listings, scenario);
  await seedDeviceTokens(users);
  await seedPublicInquiriesAndPartners();

  logger.info("Seeding dummy data completed");
}

main()
  .catch((err) => {
    logger.error({ err }, "Error seeding dummy data");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });