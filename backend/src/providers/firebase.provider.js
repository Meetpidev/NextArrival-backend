const admin = require("firebase-admin");

let initialized = false;

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      console.error(
        "[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:",
        err.message,
      );
      return null;
    }
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

function getFirebaseMessaging() {
  if (!initialized) {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      console.warn(
        "[Firebase] Firebase credentials are not configured. Push skipped.",
      );
      return null;
    }

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
    } catch (err) {
      console.error(
        "[Firebase] Failed to initialize Firebase Admin:",
        err.message,
      );
      return null;
    }
    initialized = true;
  }

  return admin.messaging();
}

async function sendPushNotification({ tokens, title, message, data = {} }) {
  if (!Array.isArray(tokens)) {
    console.error("[Firebase] Invalid tokens parameter: expected array");
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
  if (!tokens.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body: message,
      },
      data: Object.entries(data).reduce((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
          acc[key] = String(value);
        }
        return acc;
      }, {}),
    });
  } catch (err) {
    console.error("[Firebase] Failed to send push notification:", err.message);
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const invalidCodes = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
  ]);
  const invalidTokens = [];

  response.responses.forEach((result, index) => {
    if (!result.success && invalidCodes.has(result.error?.code)) {
      invalidTokens.push(tokens[index]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
}

module.exports = { sendPushNotification };
