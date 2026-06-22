const rateLimit = require("express-rate-limit");

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MESSAGE = "Too many requests, try again later.";

const createLimiter = (options = {}) => {
  if (process.env.NODE_ENV !== "production") {
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
  max: parseInt(process.env.RATE_LIMIT_API_MAX, 10) || 2000,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many requests from this IP, please try again later.",
    }),
});

const authLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 200,
  windowMs:
    parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 10) || DEFAULT_WINDOW_MS,
  skipFailedRequests: false,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many authentication requests, please try again later.",
    }),
});

const publicLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX, 10) || 3000,
  skipFailedRequests: true,
  handler: (req, res) =>
    res.status(429).json({
      status: "fail",
      message: "Too many requests to this resource, please slow down.",
    }),
});

const adminLimiter = createLimiter({
  max: parseInt(process.env.RATE_LIMIT_ADMIN_MAX, 10) || 1000,
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
