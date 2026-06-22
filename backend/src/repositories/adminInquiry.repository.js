function listContactInquiries(prisma, { page, limit, status }) {
  const where = status ? { status } : {};
  const skip = (page - 1) * limit;

  return Promise.all([
    prisma.contactUs.count({ where }),
    prisma.contactUs.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

function updateContactInquiryStatus(prisma, { id, status }) {
  return prisma.contactUs.update({
    where: { id },
    data: { status },
  });
}

function listPartnerRequests(prisma, { page, limit, status }) {
  const where = status ? { status } : {};
  const skip = (page - 1) * limit;

  return Promise.all([
    prisma.partnerInquiry.count({ where }),
    prisma.partnerInquiry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);
}

function updatePartnerRequestStatus(prisma, { id, status }) {
  return prisma.partnerInquiry.update({
    where: { id },
    data: { status },
  });
}

module.exports = {
  listContactInquiries,
  updateContactInquiryStatus,
  listPartnerRequests,
  updatePartnerRequestStatus,
};
