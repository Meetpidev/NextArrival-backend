const { prisma } = require("../config/db");
const crypto = require("crypto");
const {
  contactUsSchema,
  partnerWithUsSchema,
} = require("../schemas/validation");
const {
  isZodError,
  sendValidationError,
  sendServerError,
} = require("../utils/http");
const {
  createAdminNotification,
  enqueueNotificationJob,
} = require("../services/notification.service");
const {
  sendPartnerDecisionEmail,
} = require("../services/mail.service");

function nullableText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeNotificationText(value, maxLength = 160) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[<>"'&]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function notifyAdminsOfInquiry({
  recordId,
  recordType,
  title,
  message,
  notificationType,
}) {
  try {
    const adminNotifications = await createAdminNotification(
      {
        title,
        message,
        type: notificationType,
        relatedId: recordId,
        relatedType: recordType,
      },
      { enqueue: false },
    );

    if (adminNotifications.length) {
      await enqueueNotificationJob({
        notificationIds: adminNotifications.map((item) => item.id),
        userIds: adminNotifications.map((item) => item.userId),
        title,
        message,
        type: notificationType,
        relatedId: recordId,
        relatedType: recordType,
      });
    }
  } catch (err) {
    console.error(`Admin notification failed for ${recordType}:`, err);
  }
}

exports.submitContactUs = async (req, res) => {
  try {
    const data = contactUsSchema.parse(req.body);

    const contactRows = await prisma.$queryRaw`
      INSERT INTO "ContactUs" (
        "id",
        "whoAreYou",
        "fullName",
        "email",
        "phone",
        "destinationCity",
        "visaStatus",
        "subject",
        "messageDetail",
        "status",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${crypto.randomUUID()},
        ${data.whoAreYou},
        ${data.fullName},
        ${data.email},
        ${data.phone},
        ${nullableText(data.destinationCity)},
        ${nullableText(data.visaStatus)},
        ${data.subject},
        ${data.messageDetail},
        'PENDING',
        NOW(),
        NOW()
      )
      RETURNING "id", "createdAt"
    `;

    const contactUs = contactRows[0];

    await notifyAdminsOfInquiry({
      recordId: contactUs.id,
      recordType: "ContactUs",
      title: "New Contact Us submission",
      message: `${safeNotificationText(data.fullName, 80)} submitted a contact inquiry: ${safeNotificationText(data.subject, 120)}`,
      notificationType: "CONTACT_US_SUBMITTED",
    });

    return res.status(201).json({
      success: true,
      message: "Contact request submitted successfully.",
      data: { contactUs },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }

    console.error("[ContactUs] Submission failed:", err);

    return sendServerError(
      res,
      "Contact request submission error: " + err.message,
      "Unable to submit contact request. Please try again.",
    );
  }
};

exports.submitPartnerWithUs = async (req, res) => {
  try {
    const data = partnerWithUsSchema.parse(req.body);

    const inquiry = await prisma.partnerInquiry.create({
      data: {
        partnershipType: data.partnershipType,
        organizationName: data.organizationName,
        fullName: data.fullName,
        email: data.email,
        phone: nullableText(data.phone),
        country: data.country,
        cityRegion: nullableText(data.cityRegion),
        partnershipGoal: data.partnershipGoal,
        tellUsMore: data.tellUsMore,
      },
      select: { id: true, createdAt: true },
    });

    await notifyAdminsOfInquiry({
      recordId: inquiry.id,
      recordType: "PartnerInquiry",
      title: "New Partner Request submission",
      message: `${safeNotificationText(data.fullName, 80)} submitted a partner request for ${safeNotificationText(data.organizationName, 120)}.`,
      notificationType: "PARTNER_REQUEST_SUBMITTED",
    });

    return res.status(201).json({
      success: true,
      message:
        "Thanks for your partnership interest. Our team will review it and respond soon.",
      data: { inquiry },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }

    console.error("[PartnerInquiry] Submission failed:", err);

    return sendServerError(
      res,
      "Partner inquiry error: " + err.message,
      "Unable to submit partner inquiry. Please try again.",
    );
  }
};

exports.getAcceptedPartners = async (req, res) => {
  try {
    const partners = await prisma.partnerInquiry.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        partnershipType: true,
        organizationName: true,
        fullName: true,
        email: true,
        phone: true,
        country: true,
        cityRegion: true,
        partnershipGoal: true,
        tellUsMore: true,
        status: true,
        createdAt: true,
      },
    });

    return res.json({
      success: true,
      message: "Accepted partners retrieved successfully",
      data: { partners },
    });
  } catch (err) {
    return sendServerError(
      res,
      "Accepted partner retrieval error: " + err.message,
      "Unable to fetch accepted partners.",
    );
  }
};
