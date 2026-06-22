const router = require("express").Router();
const ctrl = require("../controllers/subscription.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.post("/", requireAuth, ctrl.createSubscription);
router.get("/", requireAuth, ctrl.getSubscriptions);
router.post("/refund", requireAuth, ctrl.createRefundRequest);

module.exports = router;
