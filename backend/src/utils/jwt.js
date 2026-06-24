const { env } = require("../config/env");
const jwt = require("jsonwebtoken");

exports.signToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    { expiresIn: "7d" },
  );
};

exports.verifyToken = (token) => {
  return jwt.verify(token, env.jwtSecret);
};

