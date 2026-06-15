const router = require("express").Router();
const ctrl = require("../controllers/listing.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { requireRole } = require("../middleware/role.middleware");

router.get("/", ctrl.getListings);
router.get("/saved", requireAuth, ctrl.getSavedListings);
router.get("/:id", ctrl.getListingById);
router.post("/", requireAuth, requireRole("OWNER"), ctrl.createListing);
router.put("/:id", requireAuth, requireRole("OWNER"), ctrl.updateListing);
router.delete("/:id", requireAuth, requireRole("OWNER"), ctrl.archiveListing);
router.post("/saved", requireAuth, ctrl.toggleSaveListing);

module.exports = router;
