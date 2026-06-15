const { ZodError } = require("zod");

function formatZodIssues(error) {
  // Zod v4 uses issues; keep errors as a fallback for older call sites.
  const issues = Array.isArray(error?.issues)
    ? error.issues
    : Array.isArray(error?.errors)
      ? error.errors
      : [];

  return issues.map((issue) => ({
    field: issue.path?.join(".") || "unknown",
    message: issue.message,
  }));
}

function isZodError(error) {
  return error instanceof ZodError || error?.name === "ZodError";
}

function sendValidationError(res, error) {
  return res.status(400).json({
    error: "Validation failed",
    details: formatZodIssues(error),
  });
}

function sendServerError(
  res,
  logMessage,
  publicMessage = "Internal server error",
) {
  if (logMessage) {
    console.error(logMessage);
  }

  return res.status(500).json({ error: publicMessage });
}

module.exports = {
  formatZodIssues,
  isZodError,
  sendValidationError,
  sendServerError,
};
