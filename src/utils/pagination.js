function toRange({ page, limit }) {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}

function buildMeta({ page, limit }, total) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total_records: total,
    total_pages: totalPages,
    has_next_page: page < totalPages,
    has_previous_page: page > 1,
  };
}

module.exports = { toRange, buildMeta };
