const { prisma } = require("../config/db");
const {
  chatQuerySchema,
  chatMessagesQuerySchema,
  chatRoomMessagesCursorSchema,
  sendMessageSchema,
  initiateChatSchema,
} = require("../schemas/validation");
const { isZodError, sendValidationError } = require("../utils/http");
const {
  createInterestRequest,
} = require("../services/interest.service");
const { createNotification } = require("../services/notification.service");
const { sendInterestError } = require("./interest.controller");

async function notifyChatReceiver(room, sender, content) {
  const receiverId = room.tenantId === sender.id ? room.ownerId : room.tenantId;
  const senderIsOwner = room.ownerId === sender.id;

  try {
    await createNotification({
      userId: receiverId,
      title: senderIsOwner ? "Owner replied to your chat" : "New chat message",
      message: `${sender.fullName || "Someone"}: ${String(content).trim().slice(0, 140)}`,
      type: senderIsOwner ? "OWNER_RESPONSE" : "CHAT_MESSAGE",
      relatedId: room.id,
      relatedType: "ChatRoom",
    });
  } catch (err) {
    console.error("Chat notification failed:", err);
  }
}

exports.getRooms = async (req, res) => {
  try {
    // Validate pagination parameters using Zod
    const validated = chatQuerySchema.parse(req.query);
    const { page, limit } = validated;
    const skip = (page - 1) * limit;

    const where =
      req.user.role === "OWNER"
        ? { ownerId: req.user.id }
        : { tenantId: req.user.id };

    const [total, rooms] = await Promise.all([
      prisma.chatRoom.count({ where }),
      prisma.chatRoom.findMany({
        where,
        include: {
          tenant: {
            select: {
              id: true,
              fullName: true,
              verificationStatus: true,
              currentCountry: true,
              destinationCountry: true,
              currentStatus: true,
              purposeOfRelocation: true,
              visaStatus: true,
              visaType: true,
              plannedMoveDate: true,
              expectedRentalDuration: true,
              residencyStatus: true,
              isUrgentMatch: true,
            },
          },
          owner: { select: { id: true, fullName: true, isVerified: true } },
          listing: { select: { id: true, title: true, rent: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({ total, page, limit, rooms });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    console.error("Chat rooms fetch error:", err);
    res.status(500).json({ error: "Unable to retrieve chat rooms" });
  }
};

exports.getMessages = async (req, res) => {
  try {
    // Validate input using Zod schema
    const validated = chatMessagesQuerySchema.parse(req.query);
    const { roomId, page, limit } = validated;

    const skip = (page - 1) * limit;

    const room = await prisma.chatRoom.findUnique({
      where: { id: String(roomId) },
    });
    if (
      !room ||
      (room.tenantId !== req.user.id && room.ownerId !== req.user.id)
    ) {
      return res.status(403).json({ error: "Forbidden access to room" });
    }

    const [total, messages] = await Promise.all([
      prisma.chatMessage.count({ where: { roomId: String(roomId) } }),
      prisma.chatMessage.findMany({
        where: { roomId: String(roomId) },
        include: { sender: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: "asc" },
        skip,
        take: limit,
      }),
    ]);

    res.json({ total, page, limit, messages });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    console.error("Chat messages fetch error:", err);
    res.status(500).json({ error: "Unable to retrieve messages" });
  }
};

exports.getRoomMessages = async (req, res) => {
  try {
    const validated = chatRoomMessagesCursorSchema.parse({
      ...req.params,
      ...req.query,
    });
    const { roomId, limit, cursor } = validated;

    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    });
    if (
      !room ||
      (room.tenantId !== req.user.id && room.ownerId !== req.user.id)
    ) {
      return res.status(403).json({ error: "Forbidden access to room" });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { roomId },
      include: { sender: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > limit;
    const pageItems = hasMore ? messages.slice(0, limit) : messages;
    const orderedMessages = pageItems.reverse();

    return res.json({
      success: true,
      data: {
        messages: orderedMessages,
        pageInfo: {
          hasMore,
          nextCursor: hasMore ? pageItems[pageItems.length - 1]?.id : null,
        },
      },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    if (err.code === "P2025") {
      return res.status(400).json({
        success: false,
        error: "Invalid message cursor",
      });
    }
    console.error("Cursor chat messages fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Unable to retrieve messages",
    });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    // Validate input using Zod schema
    const validated = sendMessageSchema.parse(req.body);
    const { roomId, content } = validated;

    const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (
      !room ||
      (room.tenantId !== req.user.id && room.ownerId !== req.user.id)
    ) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const msg = await prisma.chatMessage.create({
      data: {
        roomId,
        senderId: req.user.id,
        content: String(content).trim(),
        messageType: "TEXT",
      },
      include: {
        sender: { select: { id: true, fullName: true } },
      },
    });

    await notifyChatReceiver(room, req.user, content);

    res.json(msg);
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    console.error("Send message error:", err);
    res.status(500).json({ error: "Unable to send message" });
  }
};

exports.initiateChat = async (req, res) => {
  try {
    const validated = initiateChatSchema.parse(req.body);
    const { listingId, firstMessage } = validated;

    const result = await createInterestRequest({
      tenant: req.user,
      propertyId: listingId,
      message: firstMessage,
    });

    return res.status(201).json({
      success: true,
      message: "Interest request sent successfully",
      roomId: result.chatRoom.id,
      data: {
        interestRequest: result.interestRequest,
        chatRoomId: result.chatRoom.id,
        chatMessage: result.chatMessage,
      },
    });
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    return sendInterestError(res, err);
  }
};
