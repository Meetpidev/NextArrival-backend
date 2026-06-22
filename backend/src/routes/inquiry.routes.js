const router = require("express").Router();
const ctrl = require("../controllers/inquiry.controller");

router.post("/contact", ctrl.submitContactUs);
router.post("/partner", ctrl.submitPartnerWithUs);

module.exports = router;
