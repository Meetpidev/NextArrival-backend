require("dotenv/config");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL || "";
let resolvedDbUrl = connectionString;
if (connectionString.startsWith("prisma+postgres://")) {
  try {
    const urlObj = new URL(connectionString);
    const apiKey = urlObj.searchParams.get("api_key");
    if (apiKey) {
      const decoded = Buffer.from(apiKey, "base64").toString("utf-8");
      const json = JSON.parse(decoded);
      if (json.databaseUrl) {
        resolvedDbUrl = json.databaseUrl;
      }
    }
  } catch (e) {
    console.error("Failed to parse URL:", e);
  }
}

const pool = new Pool({ connectionString: resolvedDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding dummy data started...");

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash("NestArrivalTest2026!", salt);

  // 1. Create a Vetted Tenant
  const tenantEmail = "tenant_test@nestarrival.ca";
  let tenant = await prisma.user.findUnique({ where: { email: tenantEmail } });
  if (!tenant) {
    tenant = await prisma.user.create({
      data: {
        email: tenantEmail,
        passwordHash: hash,
        role: "TENANT",
        fullName: "Rishabh Newcomer",
        isVerified: true,
        verificationStatus: "VERIFIED",
        currentCountry: "India",
        purposeOfRelocation: "University Studies",
        visaStatus: "Valid Visa Available",
        visaType: "Study Permit",
        plannedMoveDate: "1–3 Months",
        expectedRentalDuration: "1 Year",
        residencyStatus: "International Student",
        isUrgentMatch: true,
      }
    });
    console.log("Test Tenant created: tenant_test@nestarrival.ca / NestArrivalTest2026!");
  }

  // 2. Create a Vetted Owner
  const ownerEmail = "owner_test@nestarrival.ca";
  let owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: hash,
        role: "OWNER",
        fullName: "Marcus Landlord",
        isVerified: true,
        verificationStatus: "VERIFIED",
        residencyStatus: "Canadian Citizen"
      }
    });
    console.log("Test Owner created: owner_test@nestarrival.ca / NestArrivalTest2026!");
  }

  // 3. Purchase Subscription Plan for Tenant (Standard or Elite)
  const existingSub = await prisma.subscription.findFirst({
    where: { userId: tenant.id, isActive: true }
  });
  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        userId: tenant.id,
        planId: "plan-featured",
        name: "Featured Elite",
        price: 188.0, // Plan Elite + Urgent match addon
        durationDays: 60,
        isSubscription: true,
        approachesAllowed: -1, // Unlimited
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        isActive: true
      }
    });
    console.log("Elite Subscription purchased for Test Tenant.");
  }

  // 4. Create Approved Property Listings for Owner
  const listingData = [
    {
      title: "Premium 2-Bed High-Rise Condo Downtown",
      description: "Beautiful modern condo located in core downtown Toronto. Rent includes utility fees, secure underground parking, in-suite laundry, and fast internet access. Walking distance to subway stations and grocery stores.",
      rent: 2450.0,
      location: "450 Yonge St, Toronto, ON",
      city: "Toronto",
      bedrooms: 2,
      bathrooms: 2,
    },
    {
      title: "Spacious Student Townhouse Near Campus",
      description: "Cozy furnished room blocks from university grounds. Features shared gourmet kitchen, spacious living spaces, heating/AC included, and an outdoor patio deck. Perfect for incoming international scholars.",
      rent: 1100.0,
      location: "2580 Wesbrook Mall, Vancouver, BC",
      city: "Vancouver",
      bedrooms: 4,
      bathrooms: 3,
    },
    {
      title: "Cozy Garden Suite in Quiet Suburb",
      description: "Private 1-bedroom garden basement suite in family neighborhood. Fully independent private entry, full bath, kitchen appliances, and washer/dryer. Bus stop is 2 minutes away.",
      rent: 1400.0,
      location: "123 Panorama Hills Rd NW, Calgary, AB",
      city: "Calgary",
      bedrooms: 1,
      bathrooms: 1,
    }
  ];

  const createdListings = [];
  for (const item of listingData) {
    let list = await prisma.listing.findFirst({
      where: { ownerId: owner.id, title: item.title }
    });
    if (!list) {
      list = await prisma.listing.create({
        data: {
          ownerId: owner.id,
          title: item.title,
          description: item.description,
          rent: item.rent,
          location: item.location,
          city: item.city,
          bedrooms: item.bedrooms,
          bathrooms: item.bathrooms,
          availabilityDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          status: "APPROVED"
        }
      });
      console.log(`Property seeded: "${item.title}"`);
    }
    createdListings.push(list);
  }

  // 5. Establish Chat Room & Connection Approach
  const testListing = createdListings[0];
  const existingRoom = await prisma.chatRoom.findUnique({
    where: {
      tenantId_ownerId_listingId: {
        tenantId: tenant.id,
        ownerId: owner.id,
        listingId: testListing.id
      }
    }
  });

  if (!existingRoom) {
    // Create approach credit deduction
    await prisma.approach.create({
      data: {
        tenantId: tenant.id,
        ownerId: owner.id,
        listingId: testListing.id
      }
    });

    const room = await prisma.chatRoom.create({
      data: {
        tenantId: tenant.id,
        ownerId: owner.id,
        listingId: testListing.id
      }
    });

    // Add conversation history
    const convo = [
      { senderId: tenant.id, content: "Hello Marcus! I am moving to Toronto next month on a Study Permit. I saw your Yonge St condo listing and I am very interested." },
      { senderId: owner.id, content: "Hi Rishabh, welcome to Canada! Yes, the condo is available starting from the 1st of next month. Did you check the walkthrough photo? Let me know your visa is approved." },
      { senderId: tenant.id, content: "Yes! My Study Permit is fully approved by IRCC. I've submitted it here to NestArrival for verification. I'd love to know what utilities are included." },
      { senderId: owner.id, content: "Great! Water and internet are included in the monthly rent. Hydro (electricity) is separate and usually runs around $50-$60 per month. Let me know if you would like to arrange a video call walkthrough!" }
    ];

    for (const msg of convo) {
      await prisma.chatMessage.create({
        data: {
          roomId: room.id,
          senderId: msg.senderId,
          content: msg.content
        }
      });
    }
    console.log("Chat connection and messages history seeded successfully.");
  }

  console.log("Seeding dummy data completed.");
}

main()
  .catch((e) => {
    console.error("Error seeding dummy data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
