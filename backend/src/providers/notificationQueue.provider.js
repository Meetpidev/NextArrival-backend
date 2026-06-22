const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require("@aws-sdk/client-sqs");

let sqsClient;

function getQueueUrl() {
  return process.env.NOTIFICATION_QUEUE_URL || process.env.AWS_SQS_QUEUE_URL;
}

function getSqsClient() {
  if (!sqsClient) {
    sqsClient = new SQSClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return sqsClient;
}

async function enqueueNotificationJob(payload) {
  const queueUrl = getQueueUrl();
  if (!queueUrl) {
    console.warn("[NotificationQueue] Queue URL is not configured. Skipping enqueue.");
    return { queued: false, reason: "QUEUE_URL_NOT_CONFIGURED" };
  }

  await getSqsClient().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
    }),
  );

  return { queued: true };
}

async function receiveNotificationJobs() {
  const queueUrl = getQueueUrl();
  if (!queueUrl) {
    console.warn("[NotificationQueue] Queue URL is not configured. Skipping receive.");
    return [];
  }

  const response = await getSqsClient().send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
    }),
  );

  return response.Messages || [];
}

async function deleteNotificationJob(receiptHandle) {
  const queueUrl = getQueueUrl();
  if (!queueUrl) {
    console.warn("[NotificationQueue] Queue URL is not configured. Skipping delete.");
    return { deleted: false, reason: "QUEUE_URL_NOT_CONFIGURED" };
  }

  await getSqsClient().send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );

  return { deleted: true };
}

module.exports = {
  enqueueNotificationJob,
  receiveNotificationJobs,
  deleteNotificationJob,
};
