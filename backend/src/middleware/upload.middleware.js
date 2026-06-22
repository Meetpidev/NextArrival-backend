const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedMimeTypes = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": ".png",
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeOriginal = base + ext;
    const uniqueName = `${req.user ? req.user.id : "anon"}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}_${safeOriginal}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== "file") {
      return cb(null, false);
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = allowedMimeTypes[file.mimetype];

    if (!allowedExtensions) {
      return cb(new Error("Only JPG, PNG, and PDF files are allowed"));
    }

    const normalizedExtensions = Array.isArray(allowedExtensions)
      ? allowedExtensions
      : [allowedExtensions];

    if (!normalizedExtensions.includes(extension)) {
      return cb(new Error("Only JPG, PNG, and PDF files are allowed"));
    }

    cb(null, true);
  },
});

module.exports = { upload };
