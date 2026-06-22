const router = require("express").Router();
const ctrl = require("../controllers/cms.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");

router.get("/", ctrl.getPages);
router.get("/:id", ctrl.getPage);
router.put("/", requireAuth, requireRole("ADMIN"), ctrl.updatePage);

module.exports = router;
