const { prisma } = require("../config/db");
const {
  chatQuerySchema,
  chatMessagesQuerySchema,
  sendMessageSchema,
  initiateChatSchema,
} = require("../schemas/validation");
const { isZodError, sendValidationError } = require("../utils/http");

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
              currentCountry: true,
              purposeOfRelocation: true,
              visaStatus: true,
              visaType: true,
              plannedMoveDate: true,
              expectedRentalDuration: true,
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
      },
      include: {
        sender: { select: { id: true, fullName: true } },
      },
    });

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
    // Validate input using Zod schema
    const validated = initiateChatSchema.parse(req.body);
    const { listingId, firstMessage } = validated;

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { owner: true },
    });
    if (!listing) return res.status(404).json({ error: "Listing not found" });
    if (listing.ownerId === req.user.id) {
      return res
        .status(400)
        .json({ error: "Cannot initiate chat on your own listing" });
    }
    if (listing.status !== "APPROVED") {
      return res
        .status(403)
        .json({ error: "Cannot contact owner for this listing" });
    }

    const activeSub = req.user.subscriptions?.[0];
    if (!activeSub) {
      return res
        .status(403)
        .json({ error: "Active plan required to contact owner" });
    }

    const existingRoom = await prisma.chatRoom.findFirst({
      where: {
        tenantId: req.user.id,
        listingId,
      },
    });
    if (existingRoom) {
      return res.status(400).json({
        error: "Chat already exists for this listing",
        roomId: existingRoom.id,
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const updatedSub = await tx.subscription.updateMany({
          where: {
            id: activeSub.id,
            isActive: true,
            endDate: { gte: new Date() },
            OR: [
              { approachesAllowed: -1 },
              { approachesUsed: { lt: activeSub.approachesAllowed } },
            ],
          },
          data: {
            approachesUsed: { increment: 1 },
          },
        });

        if (updatedSub.count === 0) {
          throw new Error("LIMIT_REACHED");
        }

        await tx.approach.create({
          data: {
            tenantId: req.user.id,
            ownerId: listing.ownerId,
            listingId,
          },
        });

        const room = await tx.chatRoom.create({
          data: {
            tenantId: req.user.id,
            ownerId: listing.ownerId,
            listingId,
          },
        });

        await tx.chatMessage.create({
          data: {
            roomId: room.id,
            senderId: req.user.id,
            content: String(firstMessage).trim(),
          },
        });

        return room;
      });

      res.json({
        message: "Connection established successfully!",
        roomId: result.id,
      });
    } catch (err) {
      if (err.message === "LIMIT_REACHED") {
        return res.status(403).json({
          error: "Subscription approaches limit reached. Upgrade required.",
        });
      }
      throw err;
    }
  } catch (err) {
    if (isZodError(err)) {
      return sendValidationError(res, err);
    }
    console.error("Initiate chat error:", err);
    res.status(500).json({ error: "Unable to initiate chat" });
  }
};
