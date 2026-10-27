// Minimal stand-in for the supabase-js client. Each call to from()/rpc() pops
// the next queued response, and records what was asked for.

function createFakeDb() {
  const queue = [];
  const calls = [];

  const next = () => {
    if (!queue.length) throw new Error('fakeDb: no response queued');
    return queue.shift();
  };

  function builder(table) {
    const call = { table, ops: [] };
    calls.push(call);
    const chain = {
      then(resolve, reject) {
        return Promise.resolve(next()).then(resolve, reject);
      },
    };
    for (const op of ['select', 'insert', 'eq', 'order', 'range', 'limit', 'single', 'maybeSingle']) {
      chain[op] = (...args) => {
        call.ops.push([op, ...args]);
        return chain;
      };
    }
    return chain;
  }

  return {
    calls,
    respond(...responses) {
      queue.push(...responses);
      return this;
    },
    from: (table) => builder(table),
    rpc(fn, params) {
      calls.push({ rpc: fn, params });
      return Promise.resolve(next());
    },
  };
}

module.exports = createFakeDb;
