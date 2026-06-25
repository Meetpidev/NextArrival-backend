require("dotenv/config");

const {
  receiveNotificationJobs,
  deleteNotificationJob,
} = require("../providers/notificationQueue.provider");
const { sendPushNotification } = require("../services/notification.service");
const { childLogger } = require("../config/logger");

const logger = childLogger("notification-worker");

let shouldStop = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, stopping after current batch");
  shouldStop = true;
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, stopping after current batch");
  shouldStop = true;
});

async function processJob(message) {
  let payload;
  try {
    payload = JSON.parse(message.Body);
  } catch (err) {
    logger.error({ err }, "Failed to parse notification message body");
    throw err;
  }

  const result = await sendPushNotification(payload);
  logger.info({ result }, "Push notification job processed");
}

async function startNotificationWorker() {
  logger.info("Notification worker started");

  while (!shouldStop) {
    try {
      const messages = await receiveNotificationJobs();
      if (!messages.length) {
        await sleep(5000);
        continue;
      }

      for (const message of messages) {
        try {
          await processJob(message);
          await deleteNotificationJob(message.ReceiptHandle);
        } catch (err) {
          logger.error({ err }, "Notification job failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "Notification worker polling failed");
      await sleep(5000);
    }
  }

  logger.info("Notification worker stopped gracefully");
}

if (require.main === module) {
  startNotificationWorker();
}

module.exports = { startNotificationWorker };
