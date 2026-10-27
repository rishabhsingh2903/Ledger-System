const { fromDbError } = require('../errors/dbErrors');
const { toRange, buildMeta } = require('../utils/pagination');

// PostgREST answers "416 Range Not Satisfiable" (PGRST103) when the offset is
// past the last row; we treat that as an empty page instead of an error.
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/**
 * @param {() => import('@supabase/postgrest-js').PostgrestFilterBuilder} buildQuery
 *   returns a fresh, filtered + ordered select('*', { count: 'exact' }) query
 */
async function paginate(buildQuery, pagination) {
  const { from, to } = toRange(pagination);
  const { data, count, error } = await buildQuery().range(from, to);

  if (error && error.code === RANGE_NOT_SATISFIABLE) {
    const { count: total, error: countError } = await buildQuery().limit(0);
    if (countError) throw fromDbError(countError);
    return { rows: [], meta: buildMeta(pagination, total ?? 0) };
  }
  if (error) throw fromDbError(error);

  return { rows: data, meta: buildMeta(pagination, count ?? 0) };
}

module.exports = paginate;
