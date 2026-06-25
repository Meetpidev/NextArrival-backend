/*
 * Listings controller
 *
 * Responsibilities:
 * - Search/list listings with filtering & pagination
 * - Get listing by id (with access checks for unpublished listings)
 * - Create/update listings (OWNER role + verified check)
 * - Archive listing
 * - Saved listings (bookmark toggle)
 */

const { prisma } = require("../config/db");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { sendServerError } = require("../utils/http");
const JWT_COOKIE_NAME = "nestarrival_session";

function parseCursorPagination(query, defaultLimit = 20, maxLimit = 100) {
  const pageSize = Math.min(
    Math.max(Number(query.limit) || defaultLimit, 1),
    maxLimit,
  );

  return {
    cursor:
      typeof query.cursor === "string" && query.cursor.trim()
        ? query.cursor.trim()
        : null,
    pageSize,
  };
}

function buildCursorPage(items, pageSize) {
  const hasNextPage = items.length > pageSize;
  const pageItems = hasNextPage ? items.slice(0, pageSize) : items;

  return {
    items: pageItems,
    pageInfo: {
      limit: pageSize,
      hasNextPage,
      nextCursor: hasNextPage
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null,
    },
  };
}

exports.getListings = async (req, res) => {
  try {
    const { scope, city, minRent, maxRent, bedrooms, bathrooms } = req.query;

    const { cursor, pageSize } = parseCursorPagination(req.query);

    const whereClause = {};

    if (scope === "mine" || scope === "all") {
      const token = req.cookies[JWT_COOKIE_NAME];
      if (!token) {
        return res
          .status(401)
          .json({ error: "Unauthorized. Missing session token." });
      }

      let payload;
      try {
        payload = jwt.verify(token, env.jwtSecret);
      } catch (error) {
        return res
          .status(401)
          .json({ error: "Invalid or expired session token." });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });
      if (!user) {
        return res.status(401).json({ error: "Unauthorized. User not found." });
      }
      if (user.isBanned) {
        return res.status(403).json({ error: "Account is banned." });
      }

      if (scope === "mine") {
        whereClause.ownerId = user.id;
      } else {
        if (user.role !== "ADMIN") {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      whereClause.status = { not: "ARCHIVED" };
    } else {
      whereClause.status = "APPROVED";
      if (city) {
        whereClause.city = { contains: String(city), mode: "insensitive" };
      }
      const minRentValue = Number(minRent);
      if (!Number.isNaN(minRentValue)) {
        whereClause.rent = { ...whereClause.rent, gte: minRentValue };
      }
      const maxRentValue = Number(maxRent);
      if (!Number.isNaN(maxRentValue)) {
        whereClause.rent = { ...whereClause.rent, lte: maxRentValue };
      }
      const bedroomsValue = Number(bedrooms);
      if (!Number.isNaN(bedroomsValue)) {
        whereClause.bedrooms = bedroomsValue;
      }
      const bathroomsValue = Number(bathrooms);
      if (!Number.isNaN(bathroomsValue)) {
        whereClause.bathrooms = bathroomsValue;
      }
    }

    const listings = await prisma.listing.findMany({
      where: whereClause,
      include: {
        owner: {
          select: { id: true, fullName: true, email: true, isVerified: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: pageSize + 1,
    });

    const page = buildCursorPage(listings, pageSize);

    res.json({ listings: page.items, pageInfo: page.pageInfo });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(400).json({ error: "Invalid listing cursor" });
    }

    return sendServerError(
      res,
      "Listings fetch error: " + err.message,
      "Failed to fetch listings",
    );
  }
};

exports.getListingById = async (req, res) => {
  try {
    const item = await prisma.listing.findUnique({
      where: { id: req.params.id },
      include: {
        owner: {
          select: { id: true, fullName: true, email: true, isVerified: true },
        },
      },
    });
    if (!item) return res.status(404).json({ error: "Listing not found" });

    if (item.status !== "APPROVED") {
      const token = req.cookies[JWT_COOKIE_NAME];
      if (!token) {
        return res.status(403).json({ error: "Listing not available" });
      }

      try {
        const payload = jwt.verify(token, env.jwtSecret);
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
        });
        if (!user || user.isBanned) {
          return res.status(403).json({ error: "Listing not available" });
        }

        if (item.ownerId !== user.id && user.role !== "ADMIN") {
          return res.status(403).json({ error: "Listing not available" });
        }
      } catch (error) {
        return res.status(403).json({ error: "Listing not available" });
      }
    }

    res.json(item);
  } catch (err) {
    return sendServerError(
      res,
      "Listing fetch error: " + err.message,
      "Failed to fetch listing",
    );
  }
};

exports.createListing = async (req, res) => {
  try {
    if (req.user.verificationStatus !== "VERIFIED") {
      return res
        .status(403)
        .json({ error: "Only verified property owners can add listings" });
    }

    const {
      title,
      description,
      rent,
      location,
      city,
      bedrooms,
      bathrooms,
      availabilityDate,
      photos,
    } = req.body;

    if (
      !title ||
      !description ||
      !rent ||
      !location ||
      !city ||
      !availabilityDate
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const rentValue = parseFloat(rent);
    if (Number.isNaN(rentValue) || rentValue <= 0) {
      return res.status(400).json({ error: "Invalid rent value" });
    }

    const bedroomsValue = parseInt(bedrooms || 1);
    const bathroomsValue = parseInt(bathrooms || 1);
    if (Number.isNaN(bedroomsValue) || bedroomsValue < 1) {
      return res.status(400).json({ error: "Invalid bedrooms value" });
    }
    if (Number.isNaN(bathroomsValue) || bathroomsValue < 1) {
      return res.status(400).json({ error: "Invalid bathrooms value" });
    }

    const availDate = new Date(availabilityDate);
    if (Number.isNaN(availDate.getTime())) {
      return res.status(400).json({ error: "Invalid availability date" });
    }

    const listing = await prisma.listing.create({
      data: {
        ownerId: req.user.id,
        title,
        description,
        rent: rentValue,
        location,
        city,
        bedrooms: bedroomsValue,
        bathrooms: bathroomsValue,
        availabilityDate: availDate,
        photos: Array.isArray(photos) ? photos : [],
        status: "PENDING_REVIEW",
      },
    });
    res.json(listing);
  } catch (err) {
    return sendServerError(
      res,
      "Listing create error: " + err.message,
      "Failed to create listing",
    );
  }
};

exports.updateListing = async (req, res) => {
  try {
    const {
      title,
      description,
      rent,
      location,
      city,
      bedrooms,
      bathrooms,
      availabilityDate,
      photos,
    } = req.body;

    const item = await prisma.listing.findUnique({
      where: { id: req.params.id },
    });
    if (!item || item.ownerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden. Listing not owned." });
    }

    const updates = {};
    let requiresReview = false;

    if (title !== undefined) {
      updates.title = title;
    }
    if (description !== undefined) {
      updates.description = description;
    }

    if (rent !== undefined) {
      const rentValue = parseFloat(rent);
      if (Number.isNaN(rentValue) || rentValue <= 0) {
        return res.status(400).json({ error: "Invalid rent value" });
      }
      updates.rent = rentValue;
      requiresReview = true;
    }

    if (location !== undefined) {
      updates.location = location;
      requiresReview = true;
    }

    if (city !== undefined) {
      updates.city = city;
      requiresReview = true;
    }

    if (bedrooms !== undefined) {
      const bedroomsValue = parseInt(bedrooms);
      if (Number.isNaN(bedroomsValue) || bedroomsValue < 1) {
        return res.status(400).json({ error: "Invalid bedrooms value" });
      }
      updates.bedrooms = bedroomsValue;
      requiresReview = true;
    }

    if (bathrooms !== undefined) {
      const bathroomsValue = parseInt(bathrooms);
      if (Number.isNaN(bathroomsValue) || bathroomsValue < 1) {
        return res.status(400).json({ error: "Invalid bathrooms value" });
      }
      updates.bathrooms = bathroomsValue;
      requiresReview = true;
    }

    if (availabilityDate !== undefined) {
      const availDate = new Date(availabilityDate);
      if (Number.isNaN(availDate.getTime())) {
        return res.status(400).json({ error: "Invalid availability date" });
      }
      updates.availabilityDate = availDate;
    }

    if (photos !== undefined) {
      updates.photos = Array.isArray(photos) ? photos : [];
    }

    if (requiresReview && item.status === "APPROVED") {
      updates.status = "PENDING_REVIEW";
    }

    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: updates,
    });

    res.json(updated);
  } catch (err) {
    return sendServerError(
      res,
      "Listing update error: " + err.message,
      "Failed to update listing",
    );
  }
};

exports.archiveListing = async (req, res) => {
  try {
    const item = await prisma.listing.findUnique({
      where: { id: req.params.id },
    });
    if (!item || item.ownerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: "ARCHIVED" },
    });

    res.json({ message: "Listing archived successfully." });
  } catch (err) {
    return sendServerError(
      res,
      "Listing archive error: " + err.message,
      "Failed to archive listing",
    );
  }
};

exports.getSavedListings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const list = await prisma.savedListing.findMany({
      where: {
        userId: userId
      },
      include: {
        listing: {
          include: {
            owner: {
              select: {
                id: true,
                fullName: true,
                isVerified: true
              }
            }
          }
        }
      }
    });
    // Filter out archived/non-approved listings in JS (Prisma does not support
    // where filters on to-one relation includes)
    res.json(
      list
        .filter((item) => item.listing && item.listing.status === "APPROVED")
        .map((item) => item.listing)
    );
  } catch (err) {
    return sendServerError(
      res,
      "Saved listings fetch error: " + err.message,
      "Failed to fetch saved listings",
    );
  }
};

exports.toggleSaveListing = async (req, res) => {
  try {
    const { listingId } = req.body;
    if (!listingId) {
      return res.status(400).json({ error: "Listing ID is required" });
    }

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }
    if (listing.status !== "APPROVED") {
      return res.status(400).json({ error: "Cannot save this listing" });
    }

    const existing = await prisma.savedListing.findUnique({
      where: { userId_listingId: { userId: req.user.id, listingId } },
    });

    if (existing) {
      await prisma.savedListing.delete({
        where: { userId_listingId: { userId: req.user.id, listingId } },
      });
      return res.json({ message: "Bookmark removed", saved: false });
    }

    await prisma.savedListing.create({
      data: { userId: req.user.id, listingId },
    });
    res.json({ message: "Bookmark saved", saved: true });
  } catch (err) {
    return sendServerError(
      res,
      "Save listing toggle error: " + err.message,
      "Failed to update saved listing",
    );
  }
};

