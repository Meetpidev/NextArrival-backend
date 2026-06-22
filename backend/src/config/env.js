function validateRequiredEnv() {
  // Fail fast when the app cannot safely start without these values.
  const required = ["DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  // Email is warned, not fatal, so non-email routes can still boot in production.
  if (process.env.NODE_ENV === "production") {
    const missingMailConfig = ["RESEND_API_KEY"].filter(
      (key) => !process.env[key],
    );

    if (missingMailConfig.length > 0) {
      console.warn(
        `Email verification will fail until Resend is configured: ${missingMailConfig.join(", ")}`,
      );
    }
  }
}

module.exports = { validateRequiredEnv };
