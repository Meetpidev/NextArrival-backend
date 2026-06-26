const router = require("express").Router();
const { requireAuth } = require("../middleware/auth.middleware");
const { upload } = require("../middleware/upload.middleware");
const ctrl = require("../controllers/verification.controller");

router.post("/upload", requireAuth, upload.single("file"), ctrl.uploadFile);
router.get("/files/:fileRef", requireAuth, ctrl.getUploadedFile);
router.post("/submit", requireAuth, ctrl.submitVerification);

module.exports = router;
