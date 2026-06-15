const nodemailer = require("nodemailer");

const DEFAULT_FROM = "NestArrival Verification <no-reply@nestarrival.ca>";
const OTP_TTL_MINUTES = 15;

function requireSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || DEFAULT_FROM;

  if (!host || !user || !pass) {
    return { configured: false };
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid SMTP_PORT configuration");
  }

  // Port 465 uses implicit TLS. Other ports can still upgrade with STARTTLS.
  return {
    configured: true,
    host,
    port,
    user,
    pass,
    from,
    secure:
      String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
      port === 465,
  };
}

function buildOtpEmail(otp) {
  // Table-based markup is more reliable across Gmail, Outlook, and mobile apps.
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <title>NestArrival email verification</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: Arial, Helvetica, sans-serif; color: #0f172a;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f6f8fb; margin: 0; padding: 32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <tr>
                  <td style="padding: 28px 28px 20px; text-align: center; border-bottom: 1px solid #e2e8f0;">
                    <div style="font-size: 24px; font-weight: 700; line-height: 1.2; color: #0f172a;">
                      <span style="display: inline-block; margin-left: 2px; padding: 2px 7px; border-radius: 5px; background-color: #0f172a; color: #d4ff4d;">Nest Arrival</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 12px; line-height: 1.5; color: #64748b;">
                      Verification-first newcomer housing
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 28px;">
                    <p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #334155;">
                      Hello,
                    </p>
                    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #334155;">
                      Use the verification code below to finish activating your NestArrival account.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
                      <tr>
                        <td align="center" style="padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                          <div style="font-size: 13px; line-height: 1.4; color: #64748b; margin-bottom: 8px;">
                            Verification code
                          </div>
                          <div style="font-size: 32px; line-height: 1.2; font-weight: 700; letter-spacing: 8px; color: #020617;">
                            ${otp}
                          </div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #475569;">
                      This code expires in ${OTP_TTL_MINUTES} minutes. For your security, do not share it with anyone.
                    </p>
                    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #64748b;">
                      If you did not request this email, you can safely ignore it.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 28px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                      NestArrival helps newcomers find verified housing with confidence.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    subject: "[NestArrival] Verify your email",
    html,
    text: `Your NestArrival verification code is ${otp}. This code is valid for ${OTP_TTL_MINUTES} minutes.`,
  };
}

exports.sendVerificationOtp = async (email, otp) => {
  const config = requireSmtpConfig();

  if (!config.configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP credentials are not configured");
    }

    // Local-only escape hatch so developers can test signup without SMTP.
    if (process.env.ALLOW_CONSOLE_OTP === "true") {
      console.log(`\n==================================================`);
      console.log(`[NestArrival OTP Development Fallback]`);
      console.log(`To: ${email}`);
      console.log(`OTP Code: ${otp}`);
      console.log(
        `Status: SMTP credentials missing. Printed for local testing.`,
      );
      console.log(`==================================================\n`);
      return true;
    }

    throw new Error("SMTP credentials are not configured");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const emailContent = buildOtpEmail(otp);

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  // Mask email for privacy: show first 2 chars and domain only
  const [localPart, domain] = email.split("@");
  const masked = `${localPart.slice(0, 2)}***@${domain}`;
  console.log(`[NestArrival SMTP] Verification email sent to ${masked}`);
  return true;
};

function buildResetOtpEmail(otp) {
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <title>NestArrival password reset</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f6f8fb; font-family: Arial, Helvetica, sans-serif; color: #0f172a;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f6f8fb; margin: 0; padding: 32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <tr>
                  <td style="padding: 28px 28px 20px; text-align: center; border-bottom: 1px solid #e2e8f0;">
                    <div style="font-size: 24px; font-weight: 700; line-height: 1.2; color: #0f172a;">
                      <span style="display: inline-block; margin-left: 2px; padding: 2px 7px; border-radius: 5px; background-color: #0f172a; color: #d4ff4d;">Nest Arrival</span>
                    </div>
                    <div style="margin-top: 8px; font-size: 12px; line-height: 1.5; color: #64748b;">
                      Verification-first newcomer housing
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 28px;">
                    <p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #334155;">
                      Hello,
                    </p>
                    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #334155;">
                      Use the password reset code below to reset your NestArrival password.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px;">
                      <tr>
                        <td align="center" style="padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                          <div style="font-size: 13px; line-height: 1.4; color: #64748b; margin-bottom: 8px;">
                            Password Reset Code
                          </div>
                          <div style="font-size: 32px; line-height: 1.2; font-weight: 700; letter-spacing: 8px; color: #020617;">
                            ${otp}
                          </div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #475569;">
                      This code expires in ${OTP_TTL_MINUTES} minutes. For your security, do not share it with anyone.
                    </p>
                    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #64748b;">
                      If you did not request a password reset, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 28px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                      NestArrival helps newcomers find verified housing with confidence.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return {
    subject: "[NestArrival] Reset your password",
    html,
    text: `Your NestArrival password reset code is ${otp}. This code is valid for ${OTP_TTL_MINUTES} minutes.`,
  };
}

exports.sendPasswordResetOtp = async (email, otp) => {
  const config = requireSmtpConfig();

  if (!config.configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP credentials are not configured");
    }

    if (process.env.ALLOW_CONSOLE_OTP === "true") {
      console.log(`\n==================================================`);
      console.log(`[NestArrival Password Reset OTP Development Fallback]`);
      console.log(`To: ${email}`);
      console.log(`Reset OTP Code: ${otp}`);
      console.log(
        `Status: SMTP credentials missing. Printed for local testing.`,
      );
      console.log(`==================================================\n`);
      return true;
    }

    throw new Error("SMTP credentials are not configured");
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const emailContent = buildResetOtpEmail(otp);

  await transporter.sendMail({
    from: config.from,
    to: email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });

  const [localPart, domain] = email.split("@");
  const masked = `${localPart.slice(0, 2)}***@${domain}`;
  console.log(`[NestArrival SMTP] Password reset email sent to ${masked}`);
  return true;
};

