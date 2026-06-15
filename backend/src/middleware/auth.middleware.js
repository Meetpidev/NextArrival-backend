/*
 * Authentication middleware (cookie + JWT)
 *
 * - Reads the session token from cookie: `nestarrival_session`
 * - Verifies token signature with JWT_SECRET
 * - Loads the current user from DB (including active subscription + verification request)
 * - Blocks requests for missing/invalid tokens and banned users
 */

const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");

const requireAuth = async (req, res, next) => {
  // Cookie name is consistent across REST + Socket.IO auth.
  const token = req.cookies.nestarrival_session;

  if (!token) {
    // No auth cookie: reject early.
    return res
      .status(401)
      .json({ error: "Unauthorized. Missing session token." });
  }

  try {
    // Decode/verify JWT payload.
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user record and pre-load a couple of frequently used relations
    // so controllers can rely on `req.user` having relevant info.
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        // Used by listing creation/update restrictions
        verificationRequest: true,

        // Used by subscription-gated features (e.g., chat)
        subscriptions: {
          where: { isActive: true, endDate: { gte: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!user) {
      // Token is valid but user no longer exists.
      return res.status(401).json({ error: "User session not found." });
    }

    if (user.isBanned) {
      // Banned users are authenticated but blocked.
      return res.status(403).json({ error: "Account is banned." });
    }

    // Attach user to request for downstream handlers.
    req.user = user;
    next();
  } catch (err) {
    // Covers invalid signature, expired token, malformed token, etc.
    return res.status(401).json({ error: "Invalid or expired session token." });
  }
};

module.exports = { requireAuth };
