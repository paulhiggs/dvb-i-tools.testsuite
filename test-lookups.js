import { test } from 'node:test';

import { KnownCASystemID, KnownDRMScheme } from "../lib/identifiers.mjs";

function function_test_hex(parentTest, fn, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "0x${input.toString(916)}"`);
	else
		parentTest.test(`"0x${input.toString(16)}"`, (t) => {
			t.assert.strictEqual(fn(input), expected);
		});
}

function function_test(parentTest, fn, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(fn(input), expected);
		});
}

test('Identifiers', (t) => {

	t.test("CASystemID", (t) => {
		function_test_hex(t, KnownCASystemID, 0, false);
		function_test_hex(t, KnownCASystemID, 0x098c, true);
	});

	t.test("DRMSystemID", (t) => {
		function_test(t, KnownDRMScheme, "", false)
		function_test(t, KnownDRMScheme, "3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", true)
		function_test(t, KnownDRMScheme, "urn:uuid:3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", true)
		function_test(t, KnownDRMScheme, "urn:uuid:22222222-bbbb-cccc-dddd-111111111111", false)
	})
})

