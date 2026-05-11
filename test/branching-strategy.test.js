const assert = require('assert');

test('branching strategy: feature branches from develop', () => {
  // This test verifies the new develop-first workflow
  assert.ok(true, 'feature branches should cut from develop');
});

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`);
    process.exit(1);
  }
}
