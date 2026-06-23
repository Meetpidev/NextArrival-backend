/*
 * Request validation (Zod schemas)
 *
 * Centralizes input validation for REST endpoints:
 * - Auth (signup/login/OTP)
 * - Listings (query + create/update)
 * - Chat (rooms/messages/send/initiate)
 * - Subscriptions (create + pagination + refunds)
 * - Verification (document uploads)
 * - CMS pages
 *
 * NOTE: Some routes use direct schema.parse(...). Others use the
 * validateSchema middleware wrapper defined at the bottom.
 */

const { z } = require("zod");
const { sendValidationError } = require("../utils/http");

// Auth Schemas
const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine((password) => /[A-Z]/.test(password), {
      message: "Password must contain at least one uppercase letter",
    })
    .refine((password) => /[a-z]/.test(password), {
      message: "Password must contain at least one lowercase letter",
    })
    .refine((password) => /[0-9]/.test(password), {
      message: "Password must contain at least one number",
    }),
  fullName: z
    .string()
    .min(2, "Full name must be at least 2 characters")
    .max(100),
  role: z.enum(["TENANT", "OWNER"]).optional().default("TENANT"),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const verifyOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
});

const googleAuthSchema = z.object({
  token: z.string().min(1, "Google token is required"),
  role: z.enum(["TENANT", "OWNER"]).optional().default("TENANT"),
});

const resendOtpSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine((password) => /[A-Z]/.test(password), {
      message: "Password must contain at least one uppercase letter",
    })
    .refine((password) => /[a-z]/.test(password), {
      message: "Password must contain at least one lowercase letter",
    })
    .refine((password) => /[0-9]/.test(password), {
      message: "Password must contain at least one number",
    }),
});

// Listing Schemas
const listingsQuerySchema = z.object({
  scope: z.enum(["all", "mine", "public"]).optional().default("public"),
  city: z.string().optional(),
  minRent: z.coerce.number().positive().optional(),
  maxRent: z.coerce.number().positive().optional(),
  bedrooms: z.coerce.number().int().positive().optional(),
  bathrooms: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createListingSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(200),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000),
  rent: z.number().positive("Rent must be a positive number"),
  bedrooms: z.number().int().positive("Bedrooms must be a positive integer"),
  bathrooms: z.number().int().positive("Bathrooms must be a positive integer"),
  city: z.string().min(2, "City must be at least 2 characters").max(100),
  location: z
    .string()
    .min(5, "Location must be at least 5 characters")
    .max(200),
  availabilityDate: z.string().datetime("Invalid availability date").optional(),
  amenities: z.array(z.string()).optional().default([]),
});

const updateListingSchema = createListingSchema.partial();

// Chat Schemas
const chatQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const chatMessagesQuerySchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const chatRoomMessagesCursorSchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  cursor: z.string().min(1).optional(),
});

const sendMessageSchema = z.object({
  roomId: z.string().min(1, "Room ID is required"),
  content: z.string().min(1, "Message content is required").max(2000),
});

const initiateChatSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
  firstMessage: z
    .string()
    .min(1, "Message content is required")
    .max(1000, "Message must not exceed 1000 characters"),
});

const createInterestRequestSchema = z.object({
  propertyId: z.string().min(1, "Property ID is required").optional(),
  listingId: z.string().min(1, "Listing ID is required").optional(),
  message: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(1000, "Message must not exceed 1000 characters"),
}).refine((data) => data.propertyId || data.listingId, {
  message: "Property ID or listing ID is required",
  path: ["propertyId"],
});

const interestRequestIdParamSchema = z.object({
  id: z.string().min(1, "Interest request ID is required"),
});

const respondInterestRequestSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"]),
  message: z
    .string()
    .trim()
    .max(1000, "Message must not exceed 1000 characters")
    .optional(),
});

const ownerInterestMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .max(1000, "Message must not exceed 1000 characters")
    .optional(),
});

const interestPendingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  isRead: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  type: z
    .enum([
      "INTEREST_REQUEST",
      "INQUIRY_CREATED",
      "CHAT_MESSAGE",
      "OWNER_RESPONSE",
      "INQUIRY_ACCEPTED",
      "INQUIRY_REJECTED",
      "CONTACT_US_SUBMITTED",
      "PARTNER_REQUEST_SUBMITTED",
      "SYSTEM",
    ])
    .optional(),
});

const notificationIdParamSchema = z.object({
  id: z.string().min(1, "Notification ID is required"),
});

const deviceTokenSchema = z.object({
  token: z.string().trim().min(10, "Device token is required").max(4096),
  platform: z.string().trim().max(40).optional().or(z.literal("")),
});

// Subscription Schemas
const createSubscriptionSchema = z.object({
  planId: z.string().min(1, "Plan ID is required"),
  type: z.enum(["SUBSCRIPTION", "ONE_TIME", "ONETIME"]).optional().default("SUBSCRIPTION"),
  purchaseUrgentMatch: z.boolean().optional().default(false),
});

const subscriptionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createRefundRequestSchema = z.object({
  subscriptionId: z.string().min(1, "Subscription ID is required"),
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(500, "Reason must not exceed 500 characters"),
});

// Verification Schemas
const submitVerificationSchema = z.object({
  residencyStatus: z.string().min(1, "Residency status is required"),
  documents: z
    .array(z.string().min(1))
    .min(1, "At least one document is required"),
});

// CMS Schemas
const cmsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const createCmsSchema = z.object({
  type: z.string().min(1, "Type is required"),
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required"),
  slug: z.string().min(1, "Slug is required"),
});

const updateCmsSchema = createCmsSchema.partial();

// Public inquiry schemas
const optionalText = (maxLength) =>
  z.string().trim().max(maxLength).optional().or(z.literal(""));

const normalizedEmail = z
  .string()
  .trim()
  .email("Invalid email address")
  .max(254)
  .transform((value) => value.toLowerCase());

const contactUsSchema = z.object({
  whoAreYou: z
    .string()
    .trim()
    .min(2, "Please select who you are")
    .max(80),
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(100),
  email: normalizedEmail,
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone number must be in international format, for example +14165550123"),
  destinationCity: optionalText(120),
  visaStatus: optionalText(120),
  subject: z
    .string()
    .trim()
    .min(3, "Subject must be at least 3 characters")
    .max(150),
  messageDetail: z
    .string()
    .trim()
    .min(10, "Message detail must be at least 10 characters")
    .max(3000),
});

const partnerWithUsSchema = z.object({
  partnershipType: z
    .string()
    .trim()
    .min(2, "Partnership type is required")
    .max(100),
  organizationName: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters")
    .max(150),
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(100),
  email: normalizedEmail,
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{7,15}$/, "Phone number must be in international format, for example +14165550123")
    .max(30),
  country: z.string().trim().min(2, "Country is required").max(100),
  cityRegion: optionalText(120),
  partnershipGoal: z
    .string()
    .trim()
    .min(2, "Partnership goal is required")
    .max(150),
  tellUsMore: z
    .string()
    .trim()
    .min(10, "Tell us more must be at least 10 characters")
    .max(3000),
});

const adminInquiryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PENDING", "ACCEPTED", "REJECTED"]))
    .optional(),
});

const adminInquiryStatusSchema = z.object({
  status: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["PENDING", "ACCEPTED", "REJECTED", "RESOLVED", "DELETED"])),
});

const adminInquiryIdParamSchema = z.object({
  id: z.string().min(1, "Inquiry ID is required"),
});

// Validation Middleware Wrapper
const validateSchema = (schema) => {
  return (req, res, next) => {
    try {
      const data = {
        ...req.body,
        ...req.query,
        ...req.params,
      };

      const validated = schema.parse(data);

      // Attach validated data to request
      req.validated = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendValidationError(res, error);
      }
      return res.status(400).json({ error: "Invalid request data" });
    }
  };
};

module.exports = {
  // Auth schemas
  signupSchema,
  loginSchema,
  verifyOtpSchema,
  googleAuthSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,

  // Listing schemas
  listingsQuerySchema,
  createListingSchema,
  updateListingSchema,

  // Chat schemas
  chatQuerySchema,
  chatMessagesQuerySchema,
  chatRoomMessagesCursorSchema,
  sendMessageSchema,
  initiateChatSchema,
  createInterestRequestSchema,
  interestRequestIdParamSchema,
  respondInterestRequestSchema,
  ownerInterestMessageSchema,
  interestPendingQuerySchema,
  notificationQuerySchema,
  notificationIdParamSchema,
  deviceTokenSchema,

  // Subscription schemas
  createSubscriptionSchema,
  subscriptionQuerySchema,
  createRefundRequestSchema,

  // Verification schemas
  submitVerificationSchema,

  // CMS schemas
  cmsQuerySchema,
  createCmsSchema,
  updateCmsSchema,

  // Public inquiry schemas
  contactUsSchema,
  partnerWithUsSchema,
  adminInquiryQuerySchema,
  adminInquiryStatusSchema,
  adminInquiryIdParamSchema,

  // Middleware wrapper
  validateSchema,
};


