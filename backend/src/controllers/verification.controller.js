/*
 * Verification controller
 *
 * Handles:
 * - uploading verification documents to private S3 storage
 * - serving authenticated verification documents
 * - submitting verification details + documents metadata
 */

const { prisma } = require("../config/db");
const { sendServerError } = require("../utils/http");
const {
  StorageServiceError,
  uploadPrivateObject,
  getPrivateObject,
  decodeObjectKey,
  objectOwnerIdFromKey,
  streamToReadable,
} = require("../services/storage.service");

const verificationFilePrefix = "/api/verification/files/";

function normalizeDocumentUrl(value) {
  const url = String(value || "").trim();
  if (!url.startsWith(verificationFilePrefix)) {
    return null;
  }

  const fileRef = url.slice(verificationFilePrefix.length);
  const key = decodeObjectKey(fileRef);
  if (!key) {
    return null;
  }

  return `${verificationFilePrefix}${fileRef}`;
}

function hasExpectedFileSignature(buffer, mimetype) {
  if (mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimetype === "image/png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  if (mimetype === "application/pdf") {
    return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  }

  return false;
}

function validateUploadedFile(file) {
  return Boolean(
    file &&
      Buffer.isBuffer(file.buffer) &&
      file.buffer.length > 0 &&
      hasExpectedFileSignature(file.buffer, file.mimetype),
  );
}

function canAccessObject(user, key) {
  return user.role === "ADMIN" || objectOwnerIdFromKey(key) === user.id;
}

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!validateUploadedFile(req.file)) {
      return res.status(400).json({ error: "Uploaded file content is invalid" });
    }

    const uploaded = await uploadPrivateObject({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      originalName: req.file.originalname,
      ownerId: req.user.id,
      category: "verification",
    });

    return res.json({
      message: "File uploaded successfully",
      url: `${verificationFilePrefix}${uploaded.ref}`,
    });
  } catch (err) {
    if (err instanceof StorageServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return sendServerError(res, err, "Failed to upload file");
  }
};

exports.getUploadedFile = async (req, res) => {
  try {
    const key = decodeObjectKey(req.params.fileRef);
    if (!key) {
      return res.status(400).json({ error: "Invalid file reference" });
    }

    if (!canAccessObject(req.user, key)) {
      return res.status(403).json({ error: "File not available" });
    }

    const object = await getPrivateObject(key);
    res.setHeader("Content-Type", object.contentType);
    if (object.contentLength !== undefined) {
      res.setHeader("Content-Length", String(object.contentLength));
    }
    res.setHeader("Cache-Control", "private, max-age=60");

    return streamToReadable(object.stream).pipe(res);
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NoSuchKey") {
      return res.status(404).json({ error: "File not found" });
    }
    if (err instanceof StorageServiceError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return sendServerError(res, err, "Failed to fetch file");
  }
};

exports.submitVerification = async (req, res) => {
  try {
    const {
      currentCountry,
      currentStatus,
      visaStatus,
      visaType,
      plannedMoveDate,
      purposeOfRelocation,
      expectedRentalDuration,
      residencyStatus,
      documentUrls,
      documentTypes,
      declarationsAccepted,
    } = req.body;

    const accepted =
      declarationsAccepted === true || declarationsAccepted === "true";
    if (!accepted) {
      return res
        .status(400)
        .json({ error: "Declarations must be accepted to proceed" });
    }

    const rawDocumentUrls = Array.isArray(documentUrls)
      ? documentUrls
      : typeof documentUrls === "string"
        ? [documentUrls]
        : [];
    const normalizedDocumentUrls = rawDocumentUrls
      .map(normalizeDocumentUrl)
      .filter(Boolean);

    if (normalizedDocumentUrls.length !== rawDocumentUrls.length) {
      return res.status(400).json({
        error: "Document URLs must come from authenticated verification uploads",
      });
    }

    const normalizedDocumentTypes = Array.isArray(documentTypes)
      ? documentTypes.map(String).filter((value) => value.trim())
      : typeof documentTypes === "string"
        ? [documentTypes.trim()]
        : [];

    if (normalizedDocumentUrls.length !== normalizedDocumentTypes.length) {
      return res.status(400).json({
        error: "Number of document URLs must match number of document types",
      });
    }
    if (normalizedDocumentUrls.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one document must be provided" });
    }

    if (!residencyStatus) {
      return res
        .status(400)
        .json({ error: "Residency status is required for verification" });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: {
          verificationStatus: "PENDING_VERIFICATION",
          currentCountry: currentCountry ? String(currentCountry) : null,
          currentStatus: currentStatus ? String(currentStatus) : null,
          visaStatus: visaStatus ? String(visaStatus) : null,
          visaType: visaType ? String(visaType) : null,
          plannedMoveDate: plannedMoveDate ? String(plannedMoveDate) : null,
          purposeOfRelocation: purposeOfRelocation
            ? String(purposeOfRelocation)
            : null,
          expectedRentalDuration: expectedRentalDuration
            ? String(expectedRentalDuration)
            : null,
          residencyStatus: String(residencyStatus),
        },
      }),
      prisma.verificationRequest.upsert({
        where: { userId: req.user.id },
        update: {
          residencyStatus: String(residencyStatus),
          documentUrls: normalizedDocumentUrls,
          documentTypes: normalizedDocumentTypes,
          declarationsAccepted: true,
          adminNotes: null,
        },
        create: {
          userId: req.user.id,
          residencyStatus: String(residencyStatus),
          documentUrls: normalizedDocumentUrls,
          documentTypes: normalizedDocumentTypes,
          declarationsAccepted: true,
        },
      }),
    ]);

    return res.json({ message: "Verification request submitted successfully" });
  } catch (err) {
    return sendServerError(res, err, "Failed to submit verification request");
  }
};
