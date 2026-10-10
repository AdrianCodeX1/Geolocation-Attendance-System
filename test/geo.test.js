const test = require('node:test');
const assert = require('node:assert');
const { haversineMeters } = require('../src/utils/geo');

test('same point is 0m', () => {
  assert.strictEqual(haversineMeters(-14.438, 28.446, -14.438, 28.446), 0);
});

test('~0.0001 degrees of latitude is about 11m', () => {
  const d = haversineMeters(-14.438, 28.446, -14.4381, 28.446);
  assert.ok(d > 10.5 && d < 11.7, `got ${d}`);
});
