const router = require("express").Router();
const ctrl = require("../controllers/chat.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.get("/", requireAuth, ctrl.getRooms);
router.get("/rooms/:roomId/messages", requireAuth, ctrl.getRoomMessages);
router.get("/messages", requireAuth, ctrl.getMessages);
router.post("/messages", requireAuth, ctrl.sendMessage);
router.post("/initiate", requireAuth, ctrl.initiateChat);

module.exports = router;
