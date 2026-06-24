const admin = require("firebase-admin");
const { getFirebaseServiceAccount } = require("../config/env");

let initialized = false;

function parseServiceAccount() {
  try {
    return getFirebaseServiceAccount();
  } catch (err) {
    console.error(
      "[Firebase] Invalid Firebase credential configuration:",
      err.message,
    );
    return null;
  }
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
