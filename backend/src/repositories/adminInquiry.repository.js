function listContactInquiries(prisma, { page, limit, status }) {
  const where = status ? { status } : { status: { not: "DELETED" } };
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
  if (status === "DELETED") {
    return prisma.contactUs.delete({
      where: { id },
    });
  }

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

function listAcceptedPartners(prisma, { page, limit }) {
  const where = { status: "ACCEPTED" };
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

module.exports = {
  listContactInquiries,
  updateContactInquiryStatus,
  listPartnerRequests,
  updatePartnerRequestStatus,
  listAcceptedPartners,
};
