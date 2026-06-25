const { Resend } = require("resend");
const { env } = require("../config/env");

const OTP_TTL_MINUTES = 15;

let resendClient = null;

function getResendClient() {
  if (!resendClient) {
    resendClient = new Resend(env.mail.resendApiKey);
  }

  return resendClient;
}

function getMailConfig() {
  if (!env.mail.resendApiKey) {
    return {
      configured: false,
      reason: "RESEND_API_KEY is not configured",
    };
  }

  return {
    configured: true,
    from: env.mail.from,
  };
}

function maskEmail(email) {
  const [localPart = "", domain = ""] = email.split("@");
  return `${localPart.slice(0, 2)}***@${domain}`;
}

function logConsoleOtp({ label, email, otp, reason }) {
  logger.warn(
    { label, email, otpCode: otp, reason },
    "Email delivery is using console OTP fallback",
  );
}

function logConsoleMail({ label, email, reason }) {
  logger.warn(
    { label, email, reason },
    "Email delivery is using console fallback",
  );
}

async function sendMail({ email, content, successLabel, otp = null }) {
  const config = getMailConfig();

  if (!config.configured) {
    if (env.mail.allowConsoleOtp) {
      if (otp) {
        logConsoleOtp({
          label: successLabel.console,
          email,
          otp,
          reason: config.reason || "Email service is not configured",
        });
      } else {
        logConsoleMail({
          label: successLabel.console,
          email,
          reason: config.reason || "Email service is not configured",
        });
      }
      return true;
    }

    throw new Error(config.reason || "Email service is not configured");
  }

  const { data, error } = await getResendClient().emails.send({
    from: config.from,
    to: [email],
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  if (error) {
    throw new Error(error.message || "Resend email dispatch failed");
  }

  logger.info({ email, provider: "resend", messageId: data?.id }, `${successLabel.sent} sent`);
  return true;
}

function buildOtpEmail(otp) {
  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #e2e8f0;">
                    <div style="font-size:24px;font-weight:700;line-height:1.2;color:#0f172a;">
                      <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#0f172a;color:#d4ff4d;">Nest Arrival</span>
                    </div>
                    <div style="margin-top:8px;font-size:12px;line-height:1.5;color:#64748b;">Verification-first newcomer housing</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">Hello,</p>
                    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">Use the verification code below to finish activating your NestArrival account.</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                      <tr>
                        <td align="center" style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                          <div style="font-size:13px;line-height:1.4;color:#64748b;margin-bottom:8px;">Verification code</div>
                          <div style="font-size:32px;line-height:1.2;font-weight:700;letter-spacing:8px;color:#020617;">${otp}</div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#475569;">This code expires in ${OTP_TTL_MINUTES} minutes. For your security, do not share it with anyone.</p>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">If you did not request this email, you can safely ignore it.</p>
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

function buildResetOtpEmail(otp) {
  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #e2e8f0;">
                    <div style="font-size:24px;font-weight:700;line-height:1.2;color:#0f172a;">
                      <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#0f172a;color:#d4ff4d;">Nest Arrival</span>
                    </div>
                    <div style="margin-top:8px;font-size:12px;line-height:1.5;color:#64748b;">Verification-first newcomer housing</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">Hello,</p>
                    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">Use the password reset code below to reset your NestArrival password.</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
                      <tr>
                        <td align="center" style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                          <div style="font-size:13px;line-height:1.4;color:#64748b;margin-bottom:8px;">Password Reset Code</div>
                          <div style="font-size:32px;line-height:1.2;font-weight:700;letter-spacing:8px;color:#020617;">${otp}</div>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#475569;">This code expires in ${OTP_TTL_MINUTES} minutes. For your security, do not share it with anyone.</p>
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">If you did not request a password reset, you can safely ignore this email.</p>
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

function buildPartnerDecisionEmail({ organizationName, fullName, status }) {
  const accepted = status === "ACCEPTED";
  return {
    subject: accepted
      ? "Your NestArrival partnership inquiry has been accepted"
      : "Update on your NestArrival partnership inquiry",
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;padding:32px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <tr>
                    <td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #e2e8f0;">
                      <div style="font-size:24px;font-weight:700;line-height:1.2;color:#0f172a;">
                        <span style="display:inline-block;padding:2px 7px;border-radius:5px;background:#0f172a;color:#d4ff4d;">Nest Arrival</span>
                      </div>
                      <div style="margin-top:8px;font-size:12px;line-height:1.5;color:#64748b;">Partnership team update</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px;">
                      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">Hello ${fullName || ""},</p>
                      <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#111827;">${accepted ? "We’re excited to move forward" : "Thank you for your interest"}</p>
                      <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${
                        accepted
                          ? "Our partnerships team reviewed your submission and would like to move ahead with the next steps. We will be in touch shortly to coordinate a formal discussion."
                          : "Our partnerships team reviewed your submission and, at this time, we will not be moving forward with your partnership request. Thank you for your interest."
                      }</p>                      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#475569;">Organization: <strong>${organizationName || "N/A"}</strong></p>
                      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Let us know in case of any further questions.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `Hello ${fullName || ""}\n\n${
      accepted ? "We’re excited to move forward" : "Thank you for your interest"
    }\n\n${
      accepted
        ? "Our partnerships team reviewed your submission and would like to move ahead with the next steps."
        : "Our partnerships team reviewed your submission and, at this time, we will not be moving forward."
    }\n\nOrganization: ${organizationName || "N/A"}\n`,
  };
}

exports.sendVerificationOtp = async (email, otp) =>
  sendMail({
    email,
    otp,
    content: buildOtpEmail(otp),
    successLabel: {
      console: "[NestArrival OTP Development Fallback]",
      sent: "Verification email",
    },
  });

exports.sendPasswordResetOtp = async (email, otp) =>
  sendMail({
    email,
    otp,
    content: buildResetOtpEmail(otp),
    successLabel: {
      console: "[NestArrival Password Reset OTP Development Fallback]",
      sent: "Password reset email",
    },
  });

exports.sendPartnerDecisionEmail = async (email, payload) =>
  sendMail({
    email,
    content: buildPartnerDecisionEmail(payload),
    successLabel: {
      console: "[NestArrival Partner Decision Development Fallback]",
      sent: `Partner ${payload.status.toLowerCase()} email`,
    },
  });
