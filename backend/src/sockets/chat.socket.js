/*
 * Socket.IO chat realtime layer
 *
 * Responsibilities:
 * - Authenticate socket connections using the same cookie-based JWT
 * - Authorize room membership (tenant <-> owner) before joining/sending
 * - Persist chat messages (Prisma) and broadcast them to the room
 */

const { prisma } = require("../config/db");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { createNotification } = require("../services/notification.service");

// Minimal cookie parser for Socket.IO handshake headers.
function parseCookies(cookieHeader) {
  return (cookieHeader || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .reduce((acc, cookie) => {
      const [name, value] = cookie.split("=");
      if (name && value) {
        acc[name] = decodeURIComponent(value);
      }
      return acc;
    }, {});
}

function initChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || "");
      const token = cookies.nestarrival_session;

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const payload = jwt.verify(token, env.jwtSecret);
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.isBanned) {
        return next(new Error("Unauthorized"));
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("joinRoom", async ({ roomId }) => {
      try {
        if (!roomId) return;

        const room = await prisma.chatRoom.findUnique({
          where: { id: roomId },
        });
        if (!room) return;
        if (room.tenantId !== socket.user.id && room.ownerId !== socket.user.id)
          return;

        socket.join(roomId);
      } catch (err) {
        console.error("Error joining room:", err);
      }
    });

    socket.on("sendMessage", async ({ roomId, content }) => {
      try {
        if (!roomId || !content || !String(content).trim()) return;

        const room = await prisma.chatRoom.findUnique({
          where: { id: roomId },
        });
        if (!room) return;
        if (room.tenantId !== socket.user.id && room.ownerId !== socket.user.id)
          return;

        const msg = await prisma.chatMessage.create({
          data: {
            roomId,
            senderId: socket.user.id,
            content: String(content).trim(),
            messageType: "TEXT",
          },
          include: {
            sender: { select: { id: true, fullName: true } },
          },
        });

        const receiverId =
          room.tenantId === socket.user.id ? room.ownerId : room.tenantId;
        const senderIsOwner = room.ownerId === socket.user.id;
        createNotification({
          userId: receiverId,
          title: senderIsOwner ? "Owner replied to your chat" : "New chat message",
          message: `${socket.user.fullName || "Someone"}: ${String(content).trim().slice(0, 140)}`,
          type: senderIsOwner ? "OWNER_RESPONSE" : "CHAT_MESSAGE",
          relatedId: room.id,
          relatedType: "ChatRoom",
        }).catch((err) => {
          console.error("Socket chat notification failed:", err);
        });

        io.to(roomId).emit("message", msg);
      } catch (err) {
        console.error("Error sending message:", err.message);
        socket.emit("error", { message: "Failed to send message" });
      }
    });
  });
}

module.exports = { initChatSocket };

