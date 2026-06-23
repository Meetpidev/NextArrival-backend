const router = require("express").Router();
const ctrl = require("../controllers/interest.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.post("/", requireAuth, ctrl.create);
router.post("/send", requireAuth, ctrl.create);
router.get("/pending", requireAuth, ctrl.getPending);
router.get("/:id", requireAuth, ctrl.getById);
router.post("/:id/respond", requireAuth, ctrl.respond);
router.patch("/:id/accept", requireAuth, ctrl.accept);
router.patch("/:id/reject", requireAuth, ctrl.reject);

module.exports = router;
