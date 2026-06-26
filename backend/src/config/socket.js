const { Server } = require("socket.io");
const { initChatSocket } = require("../sockets/chat.socket");
const { env } = require("./env");

const allowedOrigins = env.corsOrigins;

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

