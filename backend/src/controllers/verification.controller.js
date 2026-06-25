/*
 * Verification controller
 *
 * Handles:
 * - uploading verification documents
 * - serving authenticated verification documents
 * - submitting verification details + documents metadata
 */

const fs = require("fs");
const path = require("path");
const { prisma } = require("../config/db");
const { sendServerError } = require("../utils/http");

const uploadDir = path.resolve(__dirname, "..", "..", "uploads");
const verificationFilePrefix = "/api/verification/files/";

function normalizeDocumentUrl(value) {
  const url = String(value || "").trim();
  if (!url.startsWith(verificationFilePrefix)) {
    return null;
  }

  const filename = path.basename(url.slice(verificationFilePrefix.length));
  if (!filename || filename !== url.slice(verificationFilePrefix.length)) {
    return null;
  }

  return `${verificationFilePrefix}${filename}`;
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

async function validateUploadedFile(file) {
  const handle = await fs.promises.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, buffer.length, 0);
    return hasExpectedFileSignature(buffer, file.mimetype);
  } finally {
    await handle.close();
  }
}
function canAccessUploadedFile(user, filename) {
  return user.role === "ADMIN" || filename.startsWith(`${user.id}_`);
}

exports.uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (!(await validateUploadedFile(req.file))) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: "Uploaded file content is invalid" });
  }

  res.json({
    message: "File uploaded successfully",
    url: `${verificationFilePrefix}${req.file.filename}`,
  });
};

exports.getUploadedFile = async (req, res) => {
  const filename = path.basename(String(req.params.filename || ""));
  if (!filename || filename !== req.params.filename) {
    return res.status(400).json({ error: "Invalid file name" });
  }

  if (!canAccessUploadedFile(req.user, filename)) {
    return res.status(403).json({ error: "File not available" });
  }

  const filePath = path.join(uploadDir, filename);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${uploadDir}${path.sep}`)) {
    return res.status(400).json({ error: "Invalid file path" });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  return res.sendFile(resolvedPath);
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

    res.json({ message: "Verification request submitted successfully" });
  } catch (err) {
    return sendServerError(res, err, "Failed to submit verification request");
  }
};
