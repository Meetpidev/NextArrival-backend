/*
 * Backend main Express app
 *
 * Responsibilities:
 * - Security headers (helmet)
 * - CORS + cookie support
 * - JSON parsing + rate limiting
 * - Static serving for uploaded files
 * - Route wiring under /api/*
 * - Central error handling for JSON + multer upload errors
 */

require("dotenv/config");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const multer = require("multer");

// Rate limiter instances shared across route namespaces
const {
  generalLimiter,
  authLimiter,
  publicLimiter,
  adminLimiter,
} = require("./middleware/rateLimiter.middleware");

const authRoutes = require("./routes/auth.routes");
const listingRoutes = require("./routes/listing.routes");
const chatRoutes = require("./routes/chat.routes");
const adminRoutes = require("./routes/admin.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const verificationRoutes = require("./routes/verification.routes");
const cmsRoutes = require("./routes/cms.routes");

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...DEFAULT_ORIGINS, ...envOrigins]));

// Ensure uploads directory exists before serving it
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();

app.use((req, res, next) => {
  console.log(`[Backend Request] ${req.method} ${req.url} - Received at ${new Date().toISOString()}`);
  next();
});

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

// Security and request parsing
app.use(helmet());
app.use(
  cors({
    // Explicit allowed origins (local + optionally CORS_ORIGINS)
    origin: allowedOrigins,
    credentials: true, // enables cookie-based auth
  }),
);
app.use(express.json({ limit: "10kb" })); // limit request body size
app.use(cookieParser()); // parse Cookie header into req.cookies

// Serve uploaded files (e.g. verification docs, listing photos)
app.use("/uploads", express.static(uploadDir, { dotfiles: "deny" }));

// Rate limiting per namespace
app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/listings", publicLimiter);
app.use("/api/cms", publicLimiter);
app.use("/api/admin", adminLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cms", cmsRoutes);

// 404 handler for unknown API routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Centralized error handler (validation/json/multer)
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Invalid JSON body
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  if (err instanceof multer.MulterError) {
    const multerMessages = {
      LIMIT_FILE_SIZE: "Uploaded file must not exceed 2MB",
      LIMIT_UNEXPECTED_FILE: "Upload field must be named file",
      LIMIT_PART_COUNT: "Too many upload parts",
      LIMIT_FILE_COUNT: "Only one file can be uploaded at a time",
      LIMIT_FIELD_KEY: "Upload field name is too long",
      LIMIT_FIELD_VALUE: "Upload field value is too long",
      LIMIT_FIELD_COUNT: "Too many upload fields",
    };
    const message = multerMessages[err.code] || "File upload failed";
    return res.status(400).json({ error: message });
  }

  if (err.message === "Only JPG, PNG, and PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }

  console.error("Unhandled request error:", err);
  return res.status(500).json({ error: "Internal server error" });
});

module.exports = { app };
