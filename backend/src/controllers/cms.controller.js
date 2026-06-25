/*
 * CMS controller
 *
 * Provides CRUD-like handlers for CMS pages:
 * - fetch all pages
 * - fetch single page by id
 * - update page content/title
 */

const { prisma } = require("../config/db");
const { sendServerError } = require("../utils/http");
const { caches, clearCmsCaches } = require("../config/cache");

exports.getPages = async (req, res) => {
  try {
    const list = await caches.cms.remember(["pages"], () =>
      prisma.cmsPage.findMany(),
    );
    res.json(list);
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch CMS pages");
  }
};

exports.getPage = async (req, res) => {
  try {
    const pageCacheKey = ["page", req.params.id];
    let page = caches.cms.get(pageCacheKey);
    if (!page) {
      page = await prisma.cmsPage.findUnique({
        where: { id: req.params.id },
      });
      if (page) {
        caches.cms.set(pageCacheKey, page);
      }
    }

    if (!page) return res.status(404).json({ error: "CMS page not found" });

    res.json(page);
  } catch (err) {
    return sendServerError(res, err, "Failed to fetch CMS page");
  }
};

exports.updatePage = async (req, res) => {
  try {
    const { id, title, content } = req.body;

    if (!id || !title || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const updated = await prisma.cmsPage.update({
      where: { id },
      data: { title, content },
    });

    clearCmsCaches(id);
    res.json(updated);
  } catch (err) {
    return sendServerError(res, err, "Failed to update CMS page");
  }
};
