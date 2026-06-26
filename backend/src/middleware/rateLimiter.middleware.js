const rateLimit = require("express-rate-limit");
const { env } = require("../config/env");

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MESSAGE = "Too many requests, try again later.";

const createLimiter = (options = {}) => {
  if (!env.isProduction) {
    return (req, res, next) => next();
  }
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: DEFAULT_MESSAGE,
    skipFailedRequests: true,
    ...options,
  });
};

const generalLimiter = createLimiter({
  max: env.rateLimit.apiMax,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many requests from this IP, please try again later.",
    }),
});

const authLimiter = createLimiter({
  max: env.rateLimit.authMax,
  windowMs:
    env.rateLimit.authWindowMs,
  skipFailedRequests: false,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many authentication requests, please try again later.",
    }),
});

const publicLimiter = createLimiter({
  max: env.rateLimit.publicMax,
  skipFailedRequests: true,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many requests to this resource, please slow down.",
    }),
});

const adminLimiter = createLimiter({
  max: env.rateLimit.adminMax,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many admin requests, please wait and try again later.",
    }),
});

module.exports = {
  generalLimiter,
  authLimiter,
  publicLimiter,
  adminLimiter,
};

