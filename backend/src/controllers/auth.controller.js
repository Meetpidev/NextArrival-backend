/*
 * Auth controller
 *
 * Implements:
 * - Email/password signup + OTP verification
 * - Login (password) + OTP flow for unverified accounts
 * - Google login (OAuth2)
 * - Logout + current user session (/me)
 */

const { prisma } = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { env } = require("../config/env");
const { sendVerificationOtp, sendPasswordResetOtp } = require("../services/mail.service");
const { createOtp, hashOtp } = require("../utils/otp");
const {
  signupSchema,
  loginSchema,
  verifyOtpSchema,
  googleAuthSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require("../schemas/validation");
const {
  isZodError,
  sendValidationError,
  sendServerError,
} = require("../utils/http");

const googleClient = new OAuth2Client(env.googleClientId);
const JWT_COOKIE_NAME = "nestarrival_session";
const ALLOWED_SELF_ROLES = ["TENANT", "OWNER"];

function createToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    env.jwtSecret,
    { expiresIn: "7d" },
  );
}

function isValidRole(role) {
  return ALLOWED_SELF_ROLES.includes(String(role).toUpperCase());
}

function normalizeRole(role) {
  return isValidRole(role) ? String(role).toUpperCase() : "TENANT";
}

function isOtpMatch(storedHash, otp) {
  const hashedInput = hashOtp(otp);
  const stored = Buffer.from(storedHash);
  const input = Buffer.from(hashedInput);

  return stored.length === input.length && crypto.timingSafeEqual(stored, input);
}

function serializeAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isVerified: true,
    verificationStatus: user.verificationStatus,
  };
}

function setCookie(res, token) {
  res.cookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

exports.signup = async (req, res) => {
  logger.info("Signup request received");
  try {
    const result = signupSchema.safeParse(req.body);

    if (!result.success) {
      logger.warn({ errors: result.error.errors }, "Signup validation failed");
      return sendValidationError(res, result.error);
    }

    const { email, password, fullName, role } = result.data;
    const normalizedEmail = email.toLowerCase();

    logger.debug("Checking for existing user during signup");
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      logger.info("Signup duplicate email conflict");
      return res.status(409).json({ error: "Email already registered" });
    }

    logger.debug("Hashing signup password");
    const passwordHash = await bcrypt.hash(password, 10);

    const { otp, otpHash, otpExpiry } = createOtp();
    const normalizedRole = normalizeRole(role);
    const otpLastSentAt = new Date();

    await prisma.pendingUser.upsert({
      where: { email: normalizedEmail },
      update: {
        passwordHash,
        fullName,
        role: normalizedRole,
        otp: otpHash,
        otpExpiry,
        otpAttempts: 0,
        otpLastSentAt,
      },
      create: {
        email: normalizedEmail,
        passwordHash,
        fullName,
        role: normalizedRole,
        otp: otpHash,
        otpExpiry,
        otpAttempts: 0,
        otpLastSentAt,
      },
    });

    try {
      logger.debug("Dispatching verification OTP email");
      await sendVerificationOtp(normalizedEmail, otp);
      logger.info("OTP dispatched successfully");
    } catch (mailError) {
      logger.error({ err: mailError }, "Signup OTP email dispatch failed");
      return res.status(503).json({
        error:
          "Account details saved, but verification email could not be sent. Please request a new OTP.",
      });
    }

    logger.info("Signup flow initiated successfully");
    res.json({
      message: "Signup initiated. OTP sent to email.",
      email: normalizedEmail,
    });
  } catch (err) {
    logger.error({ err }, "Signup error caught");
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendServerError(
      res,
      "Signup error: " + err.message,
      "Signup failed",
    );
  }
};

exports.login = async (req, res) => {
  logger.info("Login request received");
  try {
    const { email, password } = loginSchema.parse(req.body);

    logger.debug("Finding user by email during login");
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      logger.info("Login failed: user not found");
      return res.status(400).json({ error: "Invalid credentials" });
    }
    if (!user.passwordHash) {
      logger.info("Login failed: user has no password hash");
      return res.status(400).json({ error: "Invalid credentials" });
    }
    logger.debug("Comparing password hash");
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      logger.info("Login failed: password mismatch");
      return res.status(400).json({ error: "Invalid credentials" });
    }
    if (user.isBanned) {
      logger.info("Login failed: account is banned");
      return res.status(403).json({ error: "Account banned" });
    }
    if (user.isVerified) {
      logger.debug("Generating JWT session token");
      const token = createToken(user);
      setCookie(res, token);

      logger.info({ userId: user.id }, "Login successful for verified user");
      return res.json({
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          isVerified: true,
        },
      });
    }
    logger.info("Initializing login verification OTP flow");
    if (
      user.otpLastSentAt &&
      Date.now() - new Date(user.otpLastSentAt).getTime() < 60_000
    ) {
      logger.info("OTP request throttled");
      return res.status(429).json({
        error: "Wait before requesting OTP again",
      });
    }
    const { otp, otpHash, otpExpiry } = createOtp();
    logger.debug("Updating user OTP details");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: otpHash,
        otpExpiry,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });
    try {
      logger.debug("Dispatching verification OTP email");
      await sendVerificationOtp(user.email, otp);
      logger.info("OTP dispatched successfully");
    } catch (mailError) {
      logger.error({ err: mailError }, "Login OTP email dispatch failed");
      return res.status(503).json({
        error: "Verification email could not be sent. Please try again later.",
      });
    }
    logger.info("OTP flow initiated");
    return res.json({
      message: "OTP sent for verification",
      isVerified: false,
      email: user.email,
    });
  } catch (err) {
    logger.error({ err }, "Login error caught");
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Login error");
    return res.status(400).json({ error: "Invalid credentials" });
  }
};
exports.googleLogin = async (req, res) => {
  try {
    if (!env.googleClientId) {
      return res.status(503).json({ error: "Google login is not configured" });
    }

    const validated = googleAuthSchema.parse(req.body);
    const { token: credential, role } = validated;

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    const { email, name, sub: googleId } = payload;

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email: email.toLowerCase() }] },
    });

    if (!user) {
      const normalizedRole = role ? normalizeRole(role) : "TENANT";
      if (!isValidRole(normalizedRole)) {
        return res.status(400).json({ error: "Invalid role selection" });
      }

      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          googleId,
          fullName: name,
          role: normalizedRole,
          isVerified: true,
          verificationStatus: "UNVERIFIED",
        },
      });
    } else {
      if (user.isBanned) {
        return res.status(403).json({ error: "Account is banned" });
      }

      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId, isVerified: true },
        });
      }
    }

    const token = createToken(user);
    setCookie(res, token);

    res.json({
      message: "Google Login successful.",
      isVerified: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified,
        verificationStatus: user.verificationStatus,
      },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Google login error");
    res.status(500).json({ error: "An error occurred during Google login" });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = verifyOtpSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const pendingUser = await prisma.pendingUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (pendingUser) {
      if (new Date() > pendingUser.otpExpiry) {
        return res.status(400).json({ error: "OTP expired" });
      }

      if (pendingUser.otpAttempts >= 5) {
        return res.status(429).json({ error: "Too many attempts" });
      }

      if (!isOtpMatch(pendingUser.otp, otp)) {
        await prisma.pendingUser.update({
          where: { email: normalizedEmail },
          data: { otpAttempts: pendingUser.otpAttempts + 1 },
        });
        return res.status(400).json({ error: "Invalid OTP" });
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (existingUser) {
        await prisma.pendingUser.delete({
          where: { email: normalizedEmail },
        });
        return res.status(409).json({ error: "Email already registered" });
      }

      const user = await prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email: pendingUser.email,
            passwordHash: pendingUser.passwordHash,
            fullName: pendingUser.fullName,
            role: pendingUser.role,
            isVerified: true,
            verificationStatus: "UNVERIFIED",
          },
        });

        await tx.pendingUser.delete({
          where: { email: normalizedEmail },
        });

        return createdUser;
      });

      const token = createToken(user);
      setCookie(res, token);

      return res.json({
        message: "Account verified successfully",
        user: serializeAuthUser(user),
      });
    }

    // Fallback: Check standard DB-based verification (for legacy unverified users)
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) return res.status(400).json({ error: "User not found" });

    if (user.isBanned) return res.status(403).json({ error: "Account banned" });

    if (!user.otp || !user.otpExpiry)
      return res.status(400).json({ error: "No OTP found" });

    if (new Date() > user.otpExpiry)
      return res.status(400).json({ error: "OTP expired" });

    if (user.otpAttempts >= 5)
      return res.status(429).json({ error: "Too many attempts" });

    const hashedInput = hashOtp(otp);
    const stored = Buffer.from(user.otp);
    const input = Buffer.from(hashedInput);

    if (stored.length !== input.length) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpAttempts: user.otpAttempts + 1,
        },
      });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const isValid = crypto.timingSafeEqual(stored, input);

    if (!isValid) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpAttempts: user.otpAttempts + 1,
        },
      });
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otp: null,
        otpExpiry: null,
        otpAttempts: 0,
        verificationStatus: "UNVERIFIED",
      },
    });

    const token = createToken(updatedUser);
    setCookie(res, token);

    res.json({
      message: "Account verified successfully",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        role: updatedUser.role,
        isVerified: true,
        verificationStatus: updatedUser.verificationStatus,
      },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Email already registered" });
    }
    logger.error({ err }, "OTP verification error");
    res.status(400).json({ error: "Invalid OTP" });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const { email } = resendOtpSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const pendingUser = await prisma.pendingUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (pendingUser) {
      if (
        pendingUser.otpLastSentAt &&
        Date.now() - new Date(pendingUser.otpLastSentAt).getTime() < 60_000
      ) {
        return res.status(429).json({
          error: "Wait before requesting OTP again",
        });
      }

      const { otp, otpHash, otpExpiry } = createOtp();
      await prisma.pendingUser.update({
        where: { email: normalizedEmail },
        data: {
          otp: otpHash,
          otpExpiry,
          otpAttempts: 0,
          otpLastSentAt: new Date(),
        },
      });

      try {
        await sendVerificationOtp(normalizedEmail, otp);
      } catch (mailError) {
        logger.error({ err: mailError }, "Resend OTP email failed");
        return res.status(503).json({
          error: "Verification email could not be sent. Please try again later.",
        });
      }

      return res.json({
        message: "OTP resent successfully",
        email: normalizedEmail,
      });
    }

    // Fallback: DB-based resend
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.isBanned) {
      return res.status(403).json({ error: "Account banned" });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: "Account is already verified" });
    }
    if (
      user.otpLastSentAt &&
      Date.now() - new Date(user.otpLastSentAt).getTime() < 60_000
    ) {
      return res.status(429).json({
        error: "Wait before requesting OTP again",
      });
    }

    const { otp, otpHash, otpExpiry } = createOtp();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: otpHash,
        otpExpiry,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    try {
      await sendVerificationOtp(normalizedEmail, otp);
    } catch (mailError) {
      logger.error({ err: mailError }, "Resend OTP email failed");
      return res.status(503).json({
        error: "Verification email could not be sent. Please try again later.",
      });
    }

    return res.json({
      message: "OTP resent successfully",
      email: normalizedEmail,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendServerError(
      res,
      "Resend OTP error: " + err.message,
      "Unable to resend OTP",
    );
  }
};

exports.logout = async (req, res) => {
  res.clearCookie(JWT_COOKIE_NAME, { path: "/" });
  res.json({ message: "Logout successful" });
};

exports.me = async (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.fullName,
      role: req.user.role,
      isVerified: req.user.isVerified,
      isBanned: req.user.isBanned,
      banReason: req.user.banReason,
      verificationStatus: req.user.verificationStatus,
      residencyStatus: req.user.residencyStatus,
      currentCountry: req.user.currentCountry,
      destinationCountry: req.user.destinationCountry,
      currentStatus: req.user.currentStatus,
      visaStatus: req.user.visaStatus,
      visaType: req.user.visaType,
      plannedMoveDate: req.user.plannedMoveDate,
      purposeOfRelocation: req.user.purposeOfRelocation,
      expectedRentalDuration: req.user.expectedRentalDuration,
      isUrgentMatch: req.user.isUrgentMatch,
      verificationRequest: req.user.verificationRequest,
      subscription: req.user.subscriptions[0] || null,
    },
  });
};

exports.forgotPassword = async (req, res) => {
  logger.info("Forgot password request received");
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      logger.info("Forgot password failed: email not found");
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isBanned) {
      logger.info("Forgot password failed: account is banned");
      return res.status(403).json({ error: "Account banned" });
    }

    const { otp, otpHash, otpExpiry } = createOtp();
    logger.debug("Storing reset OTP details");
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: otpHash,
        otpExpiry,
        otpAttempts: 0,
        otpLastSentAt: new Date(),
      },
    });

    try {
      logger.debug("Dispatching reset OTP email");
      await sendPasswordResetOtp(normalizedEmail, otp);
      logger.info("Reset OTP dispatched successfully");
    } catch (mailError) {
      logger.error({ err: mailError }, "Reset OTP email dispatch failed");
      return res.status(503).json({
        error: "Verification email could not be sent. Please try again later.",
      });
    }

    res.json({
      message: "Reset OTP sent to your email.",
      email: normalizedEmail,
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Forgot password error");
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.resetPassword = async (req, res) => {
  logger.info("Reset password request received");
  try {
    const { email, otp, newPassword } = resetPasswordSchema.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: "Account banned" });
    }

    if (!user.otp || !user.otpExpiry) {
      return res.status(400).json({ error: "No reset request found" });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(400).json({ error: "Reset code expired" });
    }

    if (user.otpAttempts >= 5) {
      return res.status(429).json({ error: "Too many attempts. Please try again." });
    }

    const hashedInput = hashOtp(otp);
    const stored = Buffer.from(user.otp);
    const input = Buffer.from(hashedInput);

    if (stored.length !== input.length) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpAttempts: user.otpAttempts + 1,
        },
      });
      return res.status(400).json({ error: "Invalid OTP code" });
    }

    const isValid = crypto.timingSafeEqual(stored, input);

    if (!isValid) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpAttempts: user.otpAttempts + 1,
        },
      });
      return res.status(400).json({ error: "Invalid OTP code" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        otp: null,
        otpExpiry: null,
        otpAttempts: 0,
      },
    });

    res.json({ message: "Password reset successful" });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    logger.error({ err }, "Reset password error");
    return res.status(500).json({ error: "Internal server error" });
  }
};

