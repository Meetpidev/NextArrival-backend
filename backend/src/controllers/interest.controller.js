const {
  createInterestRequestSchema,
  interestPendingQuerySchema,
  interestRequestIdParamSchema,
} = require("../schemas/validation");
const {
  InterestServiceError,
  createInterestRequest,
  getPendingInterestRequests,
  acceptInterestRequest,
  rejectInterestRequest,
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
    error: "Unable to send interest request",
  });
}

exports.create = async (req, res) => {
  try {
    const { propertyId, message } = createInterestRequestSchema.parse(req.body);
    const result = await createInterestRequest({
      tenant: req.user,
      propertyId,
      message,
    });

    return res.status(201).json({
      success: true,
      message: "Interest request sent successfully",
      data: {
        interestRequest: result.interestRequest,
        chatRoomId: result.chatRoom.id,
        chatMessage: result.chatMessage,
      },
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

exports.accept = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const result = await acceptInterestRequest({
      owner: req.user,
      interestRequestId: id,
    });

    return res.json({
      success: true,
      message: "Interest request accepted successfully",
      data: {
        interestRequest: result.interestRequest,
        chatRoomId: result.chatRoom.id,
        chatMessage: result.chatMessage,
      },
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

exports.reject = async (req, res) => {
  try {
    const { id } = interestRequestIdParamSchema.parse(req.params);
    const result = await rejectInterestRequest({
      owner: req.user,
      interestRequestId: id,
    });

    return res.json({
      success: true,
      message: "Interest request rejected successfully",
      data: {
        interestRequest: result.interestRequest,
        chatRoomId: result.chatRoom.id,
        chatMessage: result.chatMessage,
      },
    });
  } catch (err) {
    return sendInterestError(res, err);
  }
};

module.exports.sendInterestError = sendInterestError;
