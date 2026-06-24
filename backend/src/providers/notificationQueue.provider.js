const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} = require("@aws-sdk/client-sqs");
const { env } = require("../config/env");

let sqsClient;

function getQueueUrl() {
  return env.aws.notificationQueueUrl;
}

function getSqsClient() {
  if (!sqsClient) {
    const credentials = env.aws.accessKeyId && env.aws.secretAccessKey
      ? {
          accessKeyId: env.aws.accessKeyId,
          secretAccessKey: env.aws.secretAccessKey,
        }
      : undefined;

    sqsClient = new SQSClient({
      region: env.aws.region,
      ...(credentials ? { credentials } : {}),
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
