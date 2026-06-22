const { prisma } = require("../config/db");
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

    const contactUs = await prisma.contactUs.create({
      data: {
        whoAreYou: data.whoAreYou,
        fullName: data.fullName,
        email: data.email,
        destinationCity: nullableText(data.destinationCity),
        visaStatus: nullableText(data.visaStatus),
        subject: data.subject,
        messageDetail: data.messageDetail,
      },
      select: { id: true, createdAt: true },
    });

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

    return sendServerError(
      res,
      "Partner inquiry error: " + err.message,
      "Unable to submit partner inquiry. Please try again.",
    );
  }
};
