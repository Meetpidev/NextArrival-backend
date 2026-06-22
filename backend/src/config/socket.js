const { Server } = require("socket.io");
const { initChatSocket } = require("../sockets/chat.socket");

const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...DEFAULT_ORIGINS, ...envOrigins]));

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  initChatSocket(io);
}

function getIO() {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initSocket first.");
  }
  return io;
}

module.exports = { initSocket, getIO };
