require("dotenv/config");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { env } = require("../src/config/env");

const connectionString = env.databaseUrl || "";

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
  console.log("Seeding started...");

  // 1. Seed Admin
  const adminEmail = "admin@nestarrival.ca";
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash("NestArrivalAdmin2026!", salt);
    
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: "ADMIN",
        fullName: "NestArrival Administrator",
        isVerified: true,
        verificationStatus: "VERIFIED"
      }
    });
    console.log("Default Admin Account created successfully.");
  } else {
    console.log("Admin Account already exists.");
  }

  // 2. Seed CMS Pages
  const cmsPages = [
    {
      id: "terms",
      title: "Terms & Conditions",
      content: `# Terms & Conditions
Last updated: June 1, 2026

What this means in simple terms: You pay to contact verified owners. If no owner replies, you get a refund. We verify your documents securely. We do not sell your data. You must be at least 18 years old.

## 1. Introduction
Welcome to NestArrival. By accessing our platform, you agree to comply with and be bound by these Terms & Conditions. NestArrival operates as an international platform. Users are responsible for complying with the laws of their home country and destination.

## 2. Age Requirement
You must be at least 18 years old to create an account and use NestArrival's paid services.

## 3. Verified Connection Platform
NestArrival is a verified connection platform. We connect you with property owners but are not responsible for the terms of any tenancy agreement made between you and an owner.

## 4. Refund Policy & Verification
A refund is available if none of the verified owners you contacted reply to your messages within your active subscription period.

A valid response means the verified owner replies to your message through the NestArrival chat within your active plan period. An automated reply or an out-of-office message does not count as a response.

Verification is carried out by NestArrival's internal team. All team members are trained in document handling and privacy compliance. Verification typically takes 1–3 business days.

Your passport and visa documents are used only for identity verification. They are encrypted, stored securely, and deleted after verification is complete. No documents are shared with third parties.

## 5. Cancellation
How to cancel: You can cancel your subscription at any time from your account settings. Cancellation takes effect at the end of your current billing period. You will not be charged again after cancellation.`
    },
    {
      id: "privacy",
      title: "Privacy Policy",
      content: `# Privacy Policy
Last updated: June 1, 2026

Your privacy is important to us. Your passport and visa documents are used only for identity verification. They are encrypted, stored securely, and deleted after verification is complete. No documents are shared with third parties.`
    },
    {
      id: "refund",
      title: "Refund Policy",
      content: `# Refund Policy
Last updated: June 1, 2026

A refund is available if none of the verified owners you contacted reply to your messages within your active subscription period.

A valid response means the verified owner replies to your message through the NestArrival chat within your active plan period. An automated reply or an out-of-office message does not count as a response.

All refund claims are moderated and processed within 3 business days.`
    },
    {
      id: "verification",
      title: "Verification Policy",
      content: `# Verification Policy
Last updated: June 1, 2026

Verification is carried out by NestArrival's internal team. All team members are trained in document handling and privacy compliance. Verification typically takes 1–3 business days.

Your passport and visa documents are used only for identity verification. They are encrypted, stored securely, and deleted after verification is complete. No documents are shared with third parties.`
    },
    {
      id: "cookie",
      title: "Cookie Policy",
      content: `# Cookie Policy
Last updated: June 1, 2026

We use basic and essential session cookies to manage user logins and preserve safety status. No marketing or tracking cookies are enabled for third-party platforms.`
    },
    {
      id: "community",
      title: "Community Guidelines",
      content: `# Community Guidelines
Last updated: June 1, 2026

We promote safety and respect. Discrimination, fraudulent documentation uploads, and misleading rental fees are strictly prohibited and will result in immediate bans without eligibility for refunds.`
    },
    {
      id: "tenant-declaration",
      title: "Tenant Declaration",
      content: `I hereby declare that all information, relocation details, visa documents, and letters of admission/employment provided are true and accurate. I understand that submitting fake documents will lead to legal action and a permanent platform ban.`
    },
    {
      id: "owner-declaration",
      title: "Owner Declaration",
      content: `I declare that I am the legal owner or authorized property manager of the listing, and that all descriptions, pricing, and pictures match the actual state of the property. I agree to keep pricing fair and transparent.`
    },
    {
      id: "cancellation",
      title: "Cancellation Policy",
      content: `# Cancellation Policy
Last updated: June 1, 2026

How to cancel: You can cancel your subscription at any time from your account settings. Cancellation takes effect at the end of your current billing period. You will not be charged again after cancellation.`
    }
  ];

  for (const page of cmsPages) {
    await prisma.cmsPage.upsert({
      where: { id: page.id },
      update: { title: page.title, content: page.content },
      create: page
    });
  }

  console.log("CMS legal documents seeded successfully.");
  console.log("Seeding completed.");
}

main()
  .catch((e) => {
    console.error("Error seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

