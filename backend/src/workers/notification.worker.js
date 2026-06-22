require("dotenv/config");

const {
  receiveNotificationJobs,
  deleteNotificationJob,
} = require("../providers/notificationQueue.provider");
const { sendPushNotification } = require("../services/notification.service");

let shouldStop = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGTERM", () => {
  console.log("[NotificationWorker] SIGTERM received, stopping after current batch...");
  shouldStop = true;
});

process.on("SIGINT", () => {
  console.log("[NotificationWorker] SIGINT received, stopping after current batch...");
  shouldStop = true;
});

async function processJob(message) {
  let payload;
  try {
    payload = JSON.parse(message.Body);
  } catch (err) {
    console.error("[NotificationWorker] Failed to parse message body:", err);
    throw err;
  }

  const result = await sendPushNotification(payload);
  console.log("[NotificationWorker] Push job processed:", result);
}

async function startNotificationWorker() {
  console.log("[NotificationWorker] Started.");

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
          console.error("[NotificationWorker] Job failed:", err);
        }
      }
    } catch (err) {
      console.error("[NotificationWorker] Polling failed:", err);
      await sleep(5000);
    }
  }

  console.log("[NotificationWorker] Stopped gracefully.");
}

if (require.main === module) {
  startNotificationWorker();
}

module.exports = { startNotificationWorker };
