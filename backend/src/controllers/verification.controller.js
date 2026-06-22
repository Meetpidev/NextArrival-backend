/*
 * Verification controller
 *
 * Handles:
 * - uploading verification documents
 * - submitting verification details + documents metadata
 */

const { prisma } = require("../config/db");
const { sendServerError } = require("../utils/http");

exports.uploadFile = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  res.json({
    message: "File uploaded successfully",
    url: `/uploads/${req.file.filename}`,
  });
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

    const normalizedDocumentUrls = Array.isArray(documentUrls)
      ? documentUrls.map(String).filter((value) => value.trim())
      : typeof documentUrls === "string"
        ? [documentUrls.trim()]
        : [];

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
