const path = require("path");

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const configLogger = {
  warn(meta, message) {
    process.emitWarning(`${message}: ${JSON.stringify(meta)}`);
  },
  error(meta, message) {
    process.stderr.write(`${message}: ${JSON.stringify(meta)}\n`);
  },
};

function text(key, fallback = "") {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bool(key, fallback = false) {
  const value = text(key);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(key, fallback, { min, max } = {}) {
  const value = text(key);
  if (!value) return fallback;

  if (!/^-?\d+$/.test(value)) {
    configLogger.warn({ key, fallback }, "Invalid integer env value; using fallback");
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    (min !== undefined && parsed < min) ||
    (max !== undefined && parsed > max)
  ) {
    configLogger.warn({ key, fallback, min, max }, "Out-of-range integer env value; using fallback");
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
  port: int("PORT", 5000, { min: 0, max: 65535 }),
  requestLogging: bool("REQUEST_LOGGING", false),
  log: {
    level: text("LOG_LEVEL", text("NODE_ENV", "development") === "production" ? "info" : "debug"),
    pretty: bool("LOG_PRETTY", text("NODE_ENV", "development") !== "production"),
  },
  cache: {
    enabled: bool("CACHE_ENABLED", true),
    maxItems: int("CACHE_MAX_ITEMS", 500, { min: 1 }),
    ttlMs: int("CACHE_TTL_MS", 60 * 1000, { min: 1 }),
    listingsTtlMs: int("CACHE_LISTINGS_TTL_MS", 30 * 1000, { min: 1 }),
    cmsTtlMs: int("CACHE_CMS_TTL_MS", 5 * 60 * 1000, { min: 1 }),
    acceptedPartnersTtlMs: int("CACHE_ACCEPTED_PARTNERS_TTL_MS", 60 * 1000, {
      min: 1,
    }),
  },

  databaseUrl: text("DATABASE_URL"),
  jwtSecret: text("JWT_SECRET"),
  googleClientId: text("GOOGLE_CLIENT_ID"),

  corsOrigins: Array.from(
    new Set([
      ...(text("NODE_ENV", "development") === "production"
        ? []
        : DEFAULT_ORIGINS),
      ...list("CORS_ORIGINS"),
    ]),
  ),
  rateLimit: {
    apiMax: int("RATE_LIMIT_API_MAX", 2000, { min: 1 }),
    authMax: int("RATE_LIMIT_AUTH_MAX", 200, { min: 1 }),
    authWindowMs: int("RATE_LIMIT_AUTH_WINDOW_MS", 15 * 60 * 1000, { min: 1 }),
    publicMax: int("RATE_LIMIT_PUBLIC_MAX", 3000, { min: 1 }),
    adminMax: int("RATE_LIMIT_ADMIN_MAX", 1000, { min: 1 }),
  },

  mail: {
    from:
      text("RESEND_FROM") ||
      text("MAIL_FROM") ||
      "NestArrival <no-reply@nestarrival.ca>",
    resendApiKey: text("RESEND_API_KEY"),
    allowConsoleOtp: bool("ALLOW_CONSOLE_OTP", false),
  },

  googleSheets: {
    spreadsheetId: text("GOOGLE_SHEETS_SPREADSHEET_ID"),
    keyFile: text(
      "GOOGLE_SHEETS_KEY_FILE",
      path.join(__dirname, "..", "..", "credentials.json"),
    ),
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
    accessKeyId: text("AWS_ACCESS_KEY_ID"),
    secretAccessKey: text("AWS_SECRET_ACCESS_KEY"),
    sessionToken: text("AWS_SESSION_TOKEN"),
    notificationQueueUrl:
      text("NOTIFICATION_QUEUE_URL") || text("AWS_SQS_QUEUE_URL"),
  },
};

function validateRequiredEnv() {
  const missing = [];

  if (!env.databaseUrl) missing.push("DATABASE_URL");
  if (!env.jwtSecret) missing.push("JWT_SECRET");
  if (!env.mail.resendApiKey && !env.mail.allowConsoleOtp) {
    missing.push("RESEND_API_KEY");
  }

  if (missing.length > 0) {
    configLogger.error({ missing }, "Missing required environment variables");
    process.exit(1);
  }

}

function getGoogleSheetsKeyJson() {
  return parseJsonOrBase64("GOOGLE_SHEETS_KEY_JSON");
}

function getFirebaseServiceAccount() {
  const parsed = parseJsonOrBase64("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (parsed) return parsed;

  if (
    env.firebase.projectId &&
    env.firebase.clientEmail &&
    env.firebase.privateKey
  ) {
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
