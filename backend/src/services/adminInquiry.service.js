const { prisma } = require("../config/db");
const repo = require("../repositories/adminInquiry.repository");

function buildPagination(total, page, limit) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

async function listContactInquiries(query) {
  const [total, inquiries] = await repo.listContactInquiries(prisma, query);

  return {
    inquiries,
    pagination: buildPagination(total, query.page, query.limit),
  };
}

async function updateContactInquiryStatus({ id, status }) {
  return repo.updateContactInquiryStatus(prisma, { id, status });
}

async function listPartnerRequests(query) {
  const [total, requests] = await repo.listPartnerRequests(prisma, query);

  return {
    requests,
    pagination: buildPagination(total, query.page, query.limit),
  };
}

async function updatePartnerRequestStatus({ id, status }) {
  return repo.updatePartnerRequestStatus(prisma, { id, status });
}

async function listAcceptedPartners(query) {
  const [total, partners] = await repo.listAcceptedPartners(prisma, query);

  return {
    partners,
    pagination: buildPagination(total, query.page, query.limit),
  };
}

module.exports = {
  listContactInquiries,
  updateContactInquiryStatus,
  listPartnerRequests,
  updatePartnerRequestStatus,
  listAcceptedPartners,
};
