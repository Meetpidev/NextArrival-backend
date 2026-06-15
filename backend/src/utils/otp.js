const crypto = require("crypto");

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function createOtp() {
  const otp = generateOtp();

  return {
    otp,
    otpHash: hashOtp(otp),
    otpExpiry: new Date(Date.now() + 15 * 60 * 1000),
  };
}

module.exports = { generateOtp, hashOtp, createOtp };
