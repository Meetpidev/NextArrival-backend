function validateRequiredEnv() {
  // Fail fast when the app cannot safely start without these values.
  const required = ["DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  // SMTP is warned, not fatal, so non-email routes can still boot in production.
  if (process.env.NODE_ENV === "production") {
    const missingSmtp = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter(
      (key) => !process.env[key],
    );

    if (missingSmtp.length > 0) {
      console.warn(
        `Email verification will fail until SMTP is configured: ${missingSmtp.join(", ")}`,
      );
    }
  }
}

module.exports = { validateRequiredEnv };
