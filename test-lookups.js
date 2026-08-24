import { test } from 'node:test';

import { KnownCASystemID } from "../lib/identifiers.mjs";

function function_test_hex(parentTest, fn, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "0x${input.toString(916)}"`);
	else
		parentTest.test(`"0x${input.toString(16)}"`, (t) => {
			t.assert.strictEqual(fn(input), expected);
		});
}

test('Identifiers', (t) => {

	t.test("CASystemID", (t) => {
		function_test_hex(t, KnownCASystemID, 0, false);
		function_test_hex(t, KnownCASystemID, 0x098c, true);
	});

})

