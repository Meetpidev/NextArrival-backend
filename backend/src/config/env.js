const path = require("path");

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function text(key, fallback = "") {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(key, fallback = false) {
  const value = text(key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(key, fallback) {
  const value = text(key);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    console.warn(`Invalid integer for ${key}; using ${fallback}`);
    return fallback;
  }
  return parsed;
}

function list(key) {
  return text(key)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonOrBase64(key) {
  const rawValue = text(key);
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch {
    try {
      return JSON.parse(Buffer.from(rawValue, "base64").toString("utf8"));
    } catch {
      throw new Error(`${key} must be valid JSON or base64-encoded JSON`);
    }
  }
}

const env = {
  nodeEnv: text("NODE_ENV", "development"),
  isProduction: text("NODE_ENV", "development") === "production",
  port: int("PORT", 5000),
  requestLogging: bool("REQUEST_LOGGING", false),

  databaseUrl: text("DATABASE_URL"),
  jwtSecret: text("JWT_SECRET"),
  googleClientId: text("GOOGLE_CLIENT_ID"),

  corsOrigins: Array.from(new Set([...DEFAULT_ORIGINS, ...list("CORS_ORIGINS")])),

  rateLimit: {
    apiMax: int("RATE_LIMIT_API_MAX", 2000),
    authMax: int("RATE_LIMIT_AUTH_MAX", 200),
    authWindowMs: int("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000),
    publicMax: int("RATE_LIMIT_PUBLIC_MAX", 3000),
    adminMax: int("RATE_LIMIT_ADMIN_MAX", 1000),
  },

  mail: {
    from: text("MAIL_FROM") || text("RESEND_FROM") || "NestArrival <no-reply@nestarrival.ca>",
    resendApiKey: text("RESEND_API_KEY"),
    smtpHost: text("SMTP_HOST"),
    smtpPort: int("SMTP_PORT", 587),
    smtpSecure: bool("SMTP_SECURE", false),
    smtpUser: text("SMTP_USER"),
    smtpPass: text("SMTP_PASS"),
    allowConsoleOtp: bool("ALLOW_CONSOLE_OTP", false),
  },

  googleSheets: {
    spreadsheetId: text("GOOGLE_SHEETS_SPREADSHEET_ID"),
    keyFile: text("GOOGLE_SHEETS_KEY_FILE", path.join(__dirname, "..", "..", "credentials.json")),
    keyJsonRaw: text("GOOGLE_SHEETS_KEY_JSON"),
  },

  firebase: {
    serviceAccountJson: text("FIREBASE_SERVICE_ACCOUNT_JSON"),
    projectId: text("FIREBASE_PROJECT_ID"),
    clientEmail: text("FIREBASE_CLIENT_EMAIL"),
    privateKey: text("FIREBASE_PRIVATE_KEY"),
  },

  aws: {
    region: text("AWS_REGION") || text("AWS_DEFAULT_REGION"),
    notificationQueueUrl: text("NOTIFICATION_QUEUE_URL") || text("AWS_SQS_QUEUE_URL"),
  },
};

function validateRequiredEnv() {
  const missing = [];

  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!env.jwtSecret) missing.push("JWT_SECRET");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (env.isProduction && !env.mail.resendApiKey && !(env.mail.smtpHost && env.mail.smtpUser && env.mail.smtpPass)) {
    console.warn("Email delivery is not configured. Set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS.");
  }
}

function getGoogleSheetsKeyJson() {
  return parseJsonOrBase64("GOOGLE_SHEETS_KEY_JSON");
}

function getFirebaseServiceAccount() {
  const parsed = parseJsonOrBase64("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (parsed) return parsed;

  if (env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey) {
    return {
      projectId: env.firebase.projectId,
      clientEmail: env.firebase.clientEmail,
      privateKey: env.firebase.privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

module.exports = {
  DEFAULT_ORIGINS,
  env,
  validateRequiredEnv,
  getFirebaseServiceAccount,
  getGoogleSheetsKeyJson,
};

