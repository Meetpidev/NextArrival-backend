require("dotenv/config");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not defined in backend .env");
  process.exit(1);
}

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
    console.error("Failed to parse proxy URL:", e);
  }
}

const pool = new Pool({ connectionString: resolvedDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database with warm dummy profiles...");

  await prisma.chatMessage.deleteMany({});
  await prisma.chatRoom.deleteMany({});
  await prisma.savedListing.deleteMany({});
  await prisma.listing.deleteMany({});
  
  await prisma.user.deleteMany({
    where: { role: { in: ["TENANT", "OWNER"] } }
  });

  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash("password123", salt);

  // 2. Create Dummy Owners
  const owner1 = await prisma.user.create({
    data: {
      email: "david.owner@nestarrival.ca",
      passwordHash: password,
      fullName: "David Chen",
      role: "OWNER",
      isVerified: true,
      createdAt: new Date(),
    }
  });

  const owner2 = await prisma.user.create({
    data: {
      email: "sarah.landlord@nestarrival.ca",
      passwordHash: password,
      fullName: "Sarah Mitchell",
      role: "OWNER",
      isVerified: true,
      createdAt: new Date(),
    }
  });

  // 3. Create Dummy Tenants
  const tenant1 = await prisma.user.create({
    data: {
      email: "arjun.tenant@nestarrival.ca",
      passwordHash: password,
      fullName: "Arjun Sharma",
      role: "TENANT",
      isVerified: true,
      currentCountry: "India",
      destinationCountry: "Canada",
      visaStatus: "Approved",
      visaType: "Student Visa",
      plannedMoveDate: "2024-09-01",
      purposeOfRelocation: "Studies at UofT",
      expectedRentalDuration: "1 Year",
      createdAt: new Date(),
    }
  });

  const tenant2 = await prisma.user.create({
    data: {
      email: "maria.tenant@nestarrival.ca",
      passwordHash: password,
      fullName: "Maria Gonzalez",
      role: "TENANT",
      isVerified: true,
      currentCountry: "Mexico",
      destinationCountry: "Canada",
      visaStatus: "Approved",
      visaType: "Work Permit",
      plannedMoveDate: "2024-10-15",
      purposeOfRelocation: "Tech Job Transfer",
      expectedRentalDuration: "2 Years",
      createdAt: new Date(),
    }
  });

  // 4. Create Dummy Listings
  const listing1 = await prisma.listing.create({
    data: {
      ownerId: owner1.id,
      title: "Cozy Shared Student Unit near UofT",
      description: "A beautiful, sunlit room in a shared 3-bedroom apartment. Perfect for international students. 5 minutes walk from St. George Station.",
      rent: 850,
      location: "Bloor St W & Spadina Ave",
      city: "Toronto",
      bedrooms: 1,
      bathrooms: 1,
      availabilityDate: new Date("2024-08-15"),
      photos: ["/images/toronto_loft.png"],
      status: "APPROVED",
    }
  });

  const listing2 = await prisma.listing.create({
    data: {
      ownerId: owner2.id,
      title: "Modern Downtown Suite (Tech District)",
      description: "A stunning 1-bedroom suite in the heart of Vancouver's tech district. Features a private balcony, in-suite laundry, and gym access.",
      rent: 1950,
      location: "Yaletown",
      city: "Vancouver",
      bedrooms: 1,
      bathrooms: 1,
      availabilityDate: new Date("2024-09-01"),
      photos: ["/images/vancouver_townhouse.png"],
      status: "APPROVED",
    }
  });

  const listing3 = await prisma.listing.create({
    data: {
      ownerId: owner1.id,
      title: "Newcomer Co-Living Condo",
      description: "Affordable shared accommodation for newcomers. Fully furnished with high-speed internet included.",
      rent: 750,
      location: "Downtown",
      city: "Montreal",
      bedrooms: 1,
      bathrooms: 1,
      availabilityDate: new Date("2024-07-01"),
      photos: ["/images/montreal_studio.png"],
      status: "APPROVED",
    }
  });

  // 5. Create Dummy Chat Rooms & Messages
  const chat1 = await prisma.chatRoom.create({
    data: {
      tenantId: tenant1.id,
      ownerId: owner1.id,
      listingId: listing1.id,
    }
  });

  await prisma.chatMessage.createMany({
    data: [
      { roomId: chat1.id, senderId: tenant1.id, content: "Hi David, I am an international student from India moving to Toronto this Fall. Is this room still available?", createdAt: new Date(Date.now() - 86400000 * 2) },
      { roomId: chat1.id, senderId: owner1.id, content: "Hello Arjun! Yes, it is still available. I see your visa is already approved, which is great. When exactly are you planning to land?", createdAt: new Date(Date.now() - 86400000 * 1.5) },
      { roomId: chat1.id, senderId: tenant1.id, content: "I land on August 20th. Can we arrange a video tour of the apartment before I sign the lease?", createdAt: new Date(Date.now() - 86400000 * 1) },
      { roomId: chat1.id, senderId: owner1.id, content: "Absolutely. I'll send you a Google Meet link for tomorrow. I can show you the room and the shared kitchen.", createdAt: new Date(Date.now() - 3600000) }
    ]
  });

  const chat2 = await prisma.chatRoom.create({
    data: {
      tenantId: tenant2.id,
      ownerId: owner2.id,
      listingId: listing2.id,
    }
  });

  await prisma.chatMessage.createMany({
    data: [
      { roomId: chat2.id, senderId: tenant2.id, content: "Hi Sarah, I'm transferring to a tech firm in Yaletown next month. Your suite looks perfect.", createdAt: new Date(Date.now() - 86400000 * 3) },
      { roomId: chat2.id, senderId: owner2.id, content: "Hi Maria! Welcome to Vancouver. The location is indeed perfect for tech workers. Do you need it furnished or unfurnished?", createdAt: new Date(Date.now() - 86400000 * 2) },
      { roomId: chat2.id, senderId: tenant2.id, content: "Furnished would be ideal since I'm moving from Mexico with only two suitcases.", createdAt: new Date(Date.now() - 86400000 * 1) },
      { roomId: chat2.id, senderId: owner2.id, content: "Perfect, it comes fully furnished. I'll upload a few more pictures of the balcony view for you.", createdAt: new Date() }
    ]
  });

  console.log("✅ Dummy data seeded successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
