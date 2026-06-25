const admin = require("firebase-admin");
const { getFirebaseServiceAccount } = require("../config/env");
const { childLogger } = require("../config/logger");

const logger = childLogger("firebase-provider");

let initialized = false;

function parseServiceAccount() {
  try {
    return getFirebaseServiceAccount();
  } catch (err) {
    logger.error({ err }, "Invalid Firebase credential configuration");
    return null;
  }
}

function getFirebaseMessaging() {
  if (!initialized) {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      logger.warn("Firebase credentials are not configured. Push skipped");
      return null;
    }

    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
    } catch (err) {
      logger.error({ err }, "Failed to initialize Firebase Admin");
      return null;
    }
    initialized = true;
  }

  return admin.messaging();
}

async function sendPushNotification({ tokens, title, message, data = {} }) {
  if (!Array.isArray(tokens)) {
    logger.error("Invalid tokens parameter: expected array");
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
  if (!tokens.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
  let response;
  try {
    response = await messaging.sendEachForMulticast({
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
    logger.error({ err }, "Failed to send push notification");
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
