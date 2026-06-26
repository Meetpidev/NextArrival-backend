require("dotenv/config");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { env } = require("../src/config/env");
const { childLogger } = require("../src/config/logger");

const logger = childLogger("seed-dummy-data");

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

const pool = new Pool({ connectionString: resolveDatabaseUrl(env.databaseUrl) });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

async function createChatIfMissing({ tenantId, ownerId, listingId, messages }) {
  const existingRoom = await prisma.chatRoom.findUnique({
    where: {
      tenantId_ownerId_listingId: { tenantId, ownerId, listingId },
    },
  });

  if (existingRoom) return existingRoom;

  const room = await prisma.chatRoom.create({
    data: { tenantId, ownerId, listingId },
  });

  for (const message of messages) {
    await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        senderId: message.senderId,
        content: message.content,
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      },
    });
  }

  logger.info({ roomId: room.id }, "Dummy chat room created");
  return room;
}

async function createApproachIfMissing({ tenantId, ownerId, listingId }) {
  const existing = await prisma.approach.findUnique({
    where: { tenantId_ownerId_listingId: { tenantId, ownerId, listingId } },
  });

  if (existing) return existing;

  return prisma.approach.create({ data: { tenantId, ownerId, listingId } });
}

async function seedWarmProfiles(passwordHash) {
  const ownerDavid = await upsertUserByEmail("david.owner@nestarrival.ca", {
    passwordHash,
    fullName: "David Chen",
    role: "OWNER",
    isVerified: true,
    verificationStatus: "VERIFIED",
  });

  const ownerSarah = await upsertUserByEmail("sarah.landlord@nestarrival.ca", {
    passwordHash,
    fullName: "Sarah Mitchell",
    role: "OWNER",
    isVerified: true,
    verificationStatus: "VERIFIED",
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
    plannedMoveDate: "2024-09-01",
    purposeOfRelocation: "Studies at UofT",
    expectedRentalDuration: "1 Year",
  });

  const tenantMaria = await upsertUserByEmail("maria.tenant@nestarrival.ca", {
    passwordHash,
    fullName: "Maria Gonzalez",
    role: "TENANT",
    isVerified: true,
    verificationStatus: "VERIFIED",
    currentCountry: "Mexico",
    destinationCountry: "Canada",
    visaStatus: "Approved",
    visaType: "Work Permit",
    plannedMoveDate: "2024-10-15",
    purposeOfRelocation: "Tech Job Transfer",
    expectedRentalDuration: "2 Years",
  });

  const listingToronto = await findOrCreateListing(ownerDavid.id, {
    title: "Cozy Shared Student Unit near UofT",
    description:
      "A beautiful, sunlit room in a shared 3-bedroom apartment. Perfect for international students. 5 minutes walk from St. George Station.",
    rent: 850,
    location: "Bloor St W & Spadina Ave",
    city: "Toronto",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: new Date("2024-08-15"),
    photos: ["/images/toronto_loft.png"],
    status: "APPROVED",
  });

  const listingVancouver = await findOrCreateListing(ownerSarah.id, {
    title: "Modern Downtown Suite (Tech District)",
    description:
      "A stunning 1-bedroom suite in the heart of Vancouver's tech district. Features a private balcony, in-suite laundry, and gym access.",
    rent: 1950,
    location: "Yaletown",
    city: "Vancouver",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: new Date("2024-09-01"),
    photos: ["/images/vancouver_townhouse.png"],
    status: "APPROVED",
  });

  await findOrCreateListing(ownerDavid.id, {
    title: "Newcomer Co-Living Condo",
    description:
      "Affordable shared accommodation for newcomers. Fully furnished with high-speed internet included.",
    rent: 750,
    location: "Downtown",
    city: "Montreal",
    bedrooms: 1,
    bathrooms: 1,
    availabilityDate: new Date("2024-07-01"),
    photos: ["/images/montreal_studio.png"],
    status: "APPROVED",
  });

  await createChatIfMissing({
    tenantId: tenantArjun.id,
    ownerId: ownerDavid.id,
    listingId: listingToronto.id,
    messages: [
      {
        senderId: tenantArjun.id,
        content:
          "Hi David, I am an international student from India moving to Toronto this Fall. Is this room still available?",
        createdAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        senderId: ownerDavid.id,
        content:
          "Hello Arjun! Yes, it is still available. I see your visa is already approved, which is great. When exactly are you planning to land?",
        createdAt: new Date(Date.now() - 86400000 * 1.5),
      },
      {
        senderId: tenantArjun.id,
        content:
          "I land on August 20th. Can we arrange a video tour of the apartment before I sign the lease?",
        createdAt: new Date(Date.now() - 86400000),
      },
      {
        senderId: ownerDavid.id,
        content:
          "Absolutely. I will send you a Google Meet link for tomorrow. I can show you the room and the shared kitchen.",
        createdAt: new Date(Date.now() - 3600000),
      },
    ],
  });

  await createChatIfMissing({
    tenantId: tenantMaria.id,
    ownerId: ownerSarah.id,
    listingId: listingVancouver.id,
    messages: [
      {
        senderId: tenantMaria.id,
        content:
          "Hi Sarah, I am transferring to a tech firm in Yaletown next month. Your suite looks perfect.",
        createdAt: new Date(Date.now() - 86400000 * 3),
      },
      {
        senderId: ownerSarah.id,
        content:
          "Hi Maria! Welcome to Vancouver. The location is indeed perfect for tech workers. Do you need it furnished or unfurnished?",
        createdAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        senderId: tenantMaria.id,
        content:
          "Furnished would be ideal since I am moving from Mexico with only two suitcases.",
        createdAt: new Date(Date.now() - 86400000),
      },
      {
        senderId: ownerSarah.id,
        content:
          "Perfect, it comes fully furnished. I will upload a few more pictures of the balcony view for you.",
        createdAt: new Date(),
      },
    ],
  });
}

async function seedFeatureScenario(passwordHash) {
  const tenant = await upsertUserByEmail("tenant_test@nestarrival.ca", {
    passwordHash,
    role: "TENANT",
    fullName: "Rishabh Newcomer",
    isVerified: true,
    verificationStatus: "VERIFIED",
    currentCountry: "India",
    purposeOfRelocation: "University Studies",
    visaStatus: "Valid Visa Available",
    visaType: "Study Permit",
    plannedMoveDate: "1-3 Months",
    expectedRentalDuration: "1 Year",
    residencyStatus: "International Student",
    isUrgentMatch: true,
  });

  const owner = await upsertUserByEmail("owner_test@nestarrival.ca", {
    passwordHash,
    role: "OWNER",
    fullName: "Marcus Landlord",
    isVerified: true,
    verificationStatus: "VERIFIED",
    residencyStatus: "Canadian Citizen",
  });

  const existingSub = await prisma.subscription.findFirst({
    where: { userId: tenant.id, isActive: true },
  });

  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        userId: tenant.id,
        planId: "plan-featured",
        name: "Featured Elite",
        price: 188.0,
        durationDays: 60,
        isSubscription: true,
        approachesAllowed: -1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        isActive: true,
        status: "ACTIVE",
      },
    });
  }

  const listings = [];
  const listingData = [
    {
      title: "Premium 2-Bed High-Rise Condo Downtown",
      description:
        "Beautiful modern condo located in core downtown Toronto. Rent includes utility fees, secure underground parking, in-suite laundry, and fast internet access. Walking distance to subway stations and grocery stores.",
      rent: 2450.0,
      location: "450 Yonge St, Toronto, ON",
      city: "Toronto",
      bedrooms: 2,
      bathrooms: 2,
    },
    {
      title: "Spacious Student Townhouse Near Campus",
      description:
        "Cozy furnished room blocks from university grounds. Features shared gourmet kitchen, spacious living spaces, heating/AC included, and an outdoor patio deck. Perfect for incoming international scholars.",
      rent: 1100.0,
      location: "2580 Wesbrook Mall, Vancouver, BC",
      city: "Vancouver",
      bedrooms: 4,
      bathrooms: 3,
    },
    {
      title: "Cozy Garden Suite in Quiet Suburb",
      description:
        "Private 1-bedroom garden basement suite in family neighborhood. Fully independent private entry, full bath, kitchen appliances, and washer/dryer. Bus stop is 2 minutes away.",
      rent: 1400.0,
      location: "123 Panorama Hills Rd NW, Calgary, AB",
      city: "Calgary",
      bedrooms: 1,
      bathrooms: 1,
    },
  ];

  for (const item of listingData) {
    listings.push(
      await findOrCreateListing(owner.id, {
        ...item,
        availabilityDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: "APPROVED",
        photos: [],
      }),
    );
  }

  const testListing = listings[0];
  await createApproachIfMissing({
    tenantId: tenant.id,
    ownerId: owner.id,
    listingId: testListing.id,
  });

  await createChatIfMissing({
    tenantId: tenant.id,
    ownerId: owner.id,
    listingId: testListing.id,
    messages: [
      {
        senderId: tenant.id,
        content:
          "Hello Marcus! I am moving to Toronto next month on a Study Permit. I saw your Yonge St condo listing and I am very interested.",
      },
      {
        senderId: owner.id,
        content:
          "Hi Rishabh, welcome to Canada! Yes, the condo is available starting from the 1st of next month. Did you check the walkthrough photo? Let me know your visa is approved.",
      },
      {
        senderId: tenant.id,
        content:
          "Yes! My Study Permit is fully approved by IRCC. I have submitted it here to NestArrival for verification. I would love to know what utilities are included.",
      },
      {
        senderId: owner.id,
        content:
          "Great! Water and internet are included in the monthly rent. Hydro is separate and usually runs around $50-$60 per month. Let me know if you would like to arrange a video call walkthrough!",
      },
    ],
  });
}

async function main() {
  logger.info("Seeding dummy data started");

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash("NestArrivalTest2026!", salt);

  await seedWarmProfiles(passwordHash);
  await seedFeatureScenario(passwordHash);

  logger.info("Seeding dummy data completed");
}

main()
  .catch((err) => {
    logger.error({ err }, "Error seeding dummy data");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
