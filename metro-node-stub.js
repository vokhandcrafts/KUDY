// Metro resolution target for `node:*` specifiers inside the device bundle.
// The controllers' value-import chain (services/contentRepo/inventory.ts)
// references Node builtins that only run under the Node adapters; on device
// the app root passes no ports, so these modules load but never execute.
// Import bindings must resolve at module load, so property reads return a
// function — only an actual call fails loudly, never a silent stub value.
module.exports = new Proxy(
  {},
  {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (!(prop in target)) {
        target[prop] = function () {
          throw new Error(`KUDY: node builtin ${String(prop)} must not run in the device bundle`);
        };
      }
      return target[prop];
    },
  },
);
