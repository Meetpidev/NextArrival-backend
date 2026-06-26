const { Readable } = require("stream");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { env } = require("../config/env");
const { childLogger } = require("../config/logger");

const logger = childLogger("storage-service");
const SIGNED_URL_TTL_SECONDS = 5 * 60;

class StorageServiceError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.name = "StorageServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

let s3Client;

function assertS3Configured() {
  if (!env.aws.s3.bucket) {
    throw new StorageServiceError(
      "S3_NOT_CONFIGURED",
      "S3 bucket is not configured",
      503,
    );
  }

  if (!env.aws.region) {
    throw new StorageServiceError(
      "S3_REGION_NOT_CONFIGURED",
      "AWS region is not configured for S3 uploads",
      503,
    );
  }
}

function getS3Client() {
  assertS3Configured();
  if (!s3Client) {
    const credentials =
      env.aws.accessKeyId && env.aws.secretAccessKey
        ? {
            accessKeyId: env.aws.accessKeyId,
            secretAccessKey: env.aws.secretAccessKey,
            ...(env.aws.sessionToken
              ? { sessionToken: env.aws.sessionToken }
              : {}),
          }
        : undefined;

    s3Client = new S3Client({
      region: env.aws.region,
      ...(env.aws.s3.endpoint ? { endpoint: env.aws.s3.endpoint } : {}),
      ...(env.aws.s3.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(credentials ? { credentials } : {}),
    });
  }

  return s3Client;
}

function normalizeKeyPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function buildObjectKey({ ownerId, originalName, category = "verification" }) {
  const safeOwnerId = normalizeKeyPart(ownerId) || "anon";
  const safeName = normalizeKeyPart(originalName) || "upload";
  const prefix = normalizeKeyPart(env.aws.s3.prefix || category || "uploads");
  const random = cryptoRandom();
  return `${prefix}/${safeOwnerId}/${Date.now()}_${random}_${safeName}`;
}

function cryptoRandom() {
  return require("crypto").randomBytes(12).toString("hex");
}

function encodeObjectKey(key) {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeObjectKey(ref) {
  try {
    const key = Buffer.from(String(ref || ""), "base64url").toString("utf8");
    if (
      !key ||
      key.includes("..") ||
      key.startsWith("/") ||
      key.includes("\\")
    ) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function objectOwnerIdFromKey(key) {
  const parts = String(key || "").split("/");
  return parts.length >= 3 ? parts[1] : null;
}

async function uploadPrivateObject({
  buffer,
  contentType,
  originalName,
  ownerId,
  category,
}) {
  assertS3Configured();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new StorageServiceError("EMPTY_FILE", "Upload file is empty", 400);
  }

  const key = buildObjectKey({ ownerId, originalName, category });
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: env.aws.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: env.aws.s3.serverSideEncryption || "AES256",
      Metadata: {
        ownerId: String(ownerId || ""),
        originalName: String(originalName || "upload").slice(0, 200),
      },
    }),
  );

  const keyHash = require("crypto")
    .createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 12);
  logger.info({ keyHash, ownerId }, "Uploaded private object to S3");
  return { key, ref: encodeObjectKey(key) };
}

async function getPrivateObject(key) {
  assertS3Configured();
  const response = await getS3Client().send(
    new GetObjectCommand({ Bucket: env.aws.s3.bucket, Key: key }),
  );
  return {
    stream: response.Body,
    contentType: response.ContentType || "application/octet-stream",
    contentLength: response.ContentLength,
  };
}

async function getPrivateObjectMetadata(key) {
  assertS3Configured();
  return getS3Client().send(
    new HeadObjectCommand({ Bucket: env.aws.s3.bucket, Key: key }),
  );
}

async function deletePrivateObject(key) {
  assertS3Configured();
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: env.aws.s3.bucket, Key: key }),
  );
}

async function createSignedGetUrl(key, expiresIn = SIGNED_URL_TTL_SECONDS) {
  assertS3Configured();
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: env.aws.s3.bucket, Key: key }),
    { expiresIn },
  );
}

function streamToReadable(stream) {
  return stream instanceof Readable ? stream : Readable.from(stream);
}

module.exports = {
  StorageServiceError,
  uploadPrivateObject,
  getPrivateObject,
  getPrivateObjectMetadata,
  deletePrivateObject,
  createSignedGetUrl,
  encodeObjectKey,
  decodeObjectKey,
  objectOwnerIdFromKey,
  streamToReadable,
};

