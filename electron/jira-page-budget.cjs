const limits = require('../shared/resource-limits.json').jira;

function jsonBytes(value, label) {
  let encoded;
  try { encoded = JSON.stringify(value); }
  catch { throw new Error(`${label} returned data that could not be measured safely.`); }
  return Buffer.byteLength(encoded, 'utf8');
}

function arrayItemCount(value) {
  let count = 0;
  const stack = [value];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      count += current.length;
      for (const item of current) stack.push(item);
    } else {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return count;
}

function createPageBudget(label, bounds = {}) {
  const maxPages = bounds.maxPages ?? limits.maxPagesPerSync;
  const maxItems = bounds.maxItems ?? limits.maxItemsPerSync;
  const maxBytes = bounds.maxBytes ?? limits.maxBytesPerSync;
  let pages = 0;
  let items = 0;
  let bytes = 0;
  return {
    consume(value, itemCount = arrayItemCount(value)) {
      const pageBytes = jsonBytes(value, label);
      if (pages + 1 > maxPages) throw new Error(`${label} stopped at the ${maxPages.toLocaleString()} page safety limit; continue with the saved checkpoint or narrow the request.`);
      if (items + itemCount > maxItems) throw new Error(`${label} stopped at the ${maxItems.toLocaleString()} item safety limit; no partial result was marked complete.`);
      if (bytes + pageBytes > maxBytes) throw new Error(`${label} stopped at the ${Math.ceil(maxBytes / 1024 / 1024)} MB response safety limit; no partial result was marked complete.`);
      pages += 1;
      items += itemCount;
      bytes += pageBytes;
      return { pages, items, bytes };
    },
    get usage() { return { pages, items, bytes }; },
  };
}

module.exports = { createPageBudget, jsonBytes, arrayItemCount };
