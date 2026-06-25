const pino = require("pino");
const pretty = require("pino-pretty");
const { env } = require("./env");

function serializeError(error) {
  if (!error) return error;

  return {
    type: error.name || error.type,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode || error.status,
    stack: error.stack,
  };
}

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.body.password",
  "req.body.newPassword",
  "req.body.otp",
  "req.body.token",
  "password",
  "passwordHash",
  "otp",
  "otpHash",
  "token",
  "apiKey",
  "resendApiKey",
  "privateKey",
];

const baseOptions = {
  level: env.log.level,
  base: {
    service: "nest-arrival-backend",
    env: env.nodeEnv,
  },
  redact: {
    paths: redactPaths,
    censor: "[redacted]",
  },
  serializers: {
    err: serializeError,
  },
};

const prettyStream = env.log.pretty
  ? pretty({
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
      ignore: "pid,hostname,service,env",
      messageFormat: "[{context}] {msg}",
      singleLine: true,
      sync: true,
    })
  : undefined;

const logger = prettyStream ? pino(baseOptions, prettyStream) : pino(baseOptions);

function childLogger(context) {
  return logger.child({ context });
}

module.exports = {
  logger,
  childLogger,
};
