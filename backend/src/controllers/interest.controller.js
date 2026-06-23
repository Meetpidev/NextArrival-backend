const {
  createInterestRequestSchema,
  interestPendingQuerySchema,
  interestRequestIdParamSchema,
  respondInterestRequestSchema,
  ownerInterestMessageSchema,
} = require("../schemas/validation");
const {
  InterestServiceError,
  createInterestRequest,
  getPendingInterestRequests,
  getInterestRequest,
  acceptInterestRequest,
  rejectInterestRequest,
  respondToInterestRequest,
} = require("../services/interest.service");
const { isZodError, sendValidationError } = require("../utils/http");

function sendInterestError(res, err) {
  if (isZodError(err)) {
    return sendValidationError(res, err);
  }

  if (err instanceof InterestServiceError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }

  console.error("Interest request error:", err);
  return res.status(500).json({
    success: false,
    error: "Unable to process interest request",
  });
}

function responsePayload(result) {
  return {
    interestRequest: result.interestRequest,
    ...(result.chatRoom ? { chatRoomId: result.chatRoom.id } : {}),
    ...(result.chatMessage ? { chatMessage: result.chatMessage } : {}),
    ...(result.chatMessages ? { chatMessages: result.chatMessages } : {}),
  };
}

exports.create = async (req, res) => {
  try {
    const { propertyId, listingId, message } = createInterestRequestSchema.parse(req.body);
    const result = await createInterestRequest({
      tenant: req.user,
      propertyId: propertyId || listingId,
      message,
    });

    return res.status(201).json({
      success: true,
      message: "Interest request sent successfully",
      data: responsePayload(result),
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.getPending = async (req, res) => {
  try {
    const query = interestPendingQuerySchema.parse(req.query);
    const data = await getPendingInterestRequests({
      owner: req.user,
      page: query.page,
      limit: query.limit,
    });

    return res.json({
      success: true,
      message: "Pending interest requests retrieved successfully",
      data,
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const interestRequest = await getInterestRequest({
      user: req.user,
      interestRequestId: id,
    });

    return res.json({
      success: true,
      message: "Interest request retrieved successfully",
      data: { interestRequest },
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.accept = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const { message } = ownerInterestMessageSchema.parse(req.body || {});
    const result = await acceptInterestRequest({
      owner: req.user,
      interestRequestId: id,
      ownerMessage: message,
    });

    return res.json({
      success: true,
      message: "Interest request accepted successfully",
      data: responsePayload(result),
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.reject = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const { message } = ownerInterestMessageSchema.parse(req.body || {});
    const result = await rejectInterestRequest({
      owner: req.user,
      interestRequestId: id,
      ownerMessage: message,
    });

    return res.json({
      success: true,
      message: "Interest request rejected successfully",
      data: responsePayload(result),
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.respond = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const { action, message } = respondInterestRequestSchema.parse(req.body || {});
    const result = await respondToInterestRequest({
      owner: req.user,
      interestRequestId: id,
      action,
      ownerMessage: message,
    });

    return res.json({
      success: true,
      message: "Interest request response sent successfully",
      data: responsePayload(result),
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

module.exports.sendInterestError = sendInterestError;
