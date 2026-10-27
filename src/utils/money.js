// numeric(18,2) comes back from PostgREST as a JSON number. Amounts are capped
// by validation so values stay well inside Number's safe integer range.
const toMoney = (value) => (value === null || value === undefined ? value : Number(value));

module.exports = { toMoney };
