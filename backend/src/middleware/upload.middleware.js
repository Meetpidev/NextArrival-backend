const multer = require("multer");
const path = require("path");

const allowedMimeTypes = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname !== "file") {
      return cb(null, false);
    }

    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = allowedMimeTypes[file.mimetype];

    if (!allowedExtensions || !allowedExtensions.includes(extension)) {
      return cb(new Error("Only JPG, PNG, and PDF files are allowed"));
    }

    return cb(null, true);
  },
});

module.exports = { upload, allowedMimeTypes };
