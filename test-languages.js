import { test, describe } from 'node:test';

import { BCP47_Language_Tag } from "../lib/pattern_checks.mjs";



function expression_test(parentTest, re, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(re.test(input), expected);
		});
}

function expression_test_groups(parentTest, re, input, expectFn, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			const res = input.match(re);
			if (res && res.groups)
				t.assert.strictEqual(expectFn(res.groups), true);
		});
}


describe("Languages", () => {

	test("Simple", (t) => {
		const re = new RegExp(`^${BCP47_Language_Tag}$`);

		expression_test(t, re, "", false);

		expression_test(t, re, "eng", true);
		expression_test(t, re, "english", true);
		expression_test(t, re, "engl!sh", false);
	
		expression_test(t, re, "zh-Hant-CN-x-private1-private2", true);
		expression_test(t, re, "zh-Hant-CN-x-private1", true);
		expression_test(t, re, "zh-Hant-CN", true);
		expression_test(t, re, "zh-Hant", true);
		expression_test(t, re, "zh-hant", false);
		expression_test(t, re, "zh", true);

		expression_test(t, re, "zh-Hant-CN-x-", false);
		expression_test(t, re, "zh-Hant-CN-x", false);
		expression_test(t, re, "zh-", false);
		expression_test(t, re, "zh-ziang", true);

		expression_test(t, re, "de", true);
		expression_test(t, re, "de-CH", true);
		expression_test(t, re, "de-CH-1901", true);
		expression_test(t, re, "es-419", true);
		expression_test(t, re, "es-4192", true);
		expression_test(t, re, "es-41", false);
		expression_test(t, re, "es-90210", false);
		expression_test(t, re, "sl-IT-nedis", true);
		expression_test(t, re, "en-US-boont", true);
		expression_test(t, re, "mn-Cyrl-MN", true);
		expression_test(t, re, "x-fr-CH", true);
		expression_test(t, re, "en-GB-boont-r-extended-sequence-x-private", true);
		expression_test(t, re, "sr-Cyrl", true);
		expression_test(t, re, "sr-Latn", true);
		expression_test(t, re, "hy-Latn-IT-arevela", true);
		expression_test(t, re, "zh-TW", true);
	});
	
	test("Groups", (t) => {
		const re = new RegExp(`^${BCP47_Language_Tag}$`);

		const should_fail = (res) => res == null;

		function match(t, result, expect) {
			for (let resProperty in result)
				t.assert.strictEqual(result[resProperty], expect[resProperty], `mismatch "${resProperty}"`)
			for (let expectProperty in expect)
				t.assert.strictEqual(result[expectProperty], expect[expectProperty], `mismatch "${expectProperty}"`)
			return true;
		}

		expression_test_groups(t, re, "", should_fail);

		expression_test_groups(t, re, "eng",
			(res) => match(t, res, {language:"eng"})
		);
	
		expression_test_groups(t, re, "english",
			(res) => match(t, res, {language: "english"})
		);

		expression_test_groups(t, re, "engl!sh", should_fail);

		expression_test_groups(t, re, "zh-Hant-CN-x-private1-private2",
			(res) => match(t, res, {language: "zh", script: "Hant", region: "CN", privateUse2: "x-private1-private2"})
		);	

		expression_test_groups(t, re, "zh-Hant-CN-x-private1", 
			(res) => match(t, res, {language: "zh", script: "Hant", region: "CN", privateUse2: "x-private1"})
		);

		expression_test_groups(t, re, "zh-Hant-CN", 
			(res) => match(t, res, {language: "zh", script: "Hant", region: "CN"})
		);

		expression_test_groups(t, re, "zh-Hant", 
			(res) => match(t, res, {language: "zh", script: "Hant"})
		);

		expression_test_groups(t, re, "zh-hant", should_fail);	

		expression_test_groups(t, re, "zh", (res) => match(t, res, {language: "zh"}));

		expression_test_groups(t, re, "zh-Hant-CN-x-", should_fail);

		expression_test_groups(t, re, "zh-Hant-CN-x", should_fail);

		expression_test_groups(t, re, "zh-", should_fail);

		expression_test_groups(t, re, "zh-ziang", 
			(res) => match(t, res, {language: "zh", variant: "ziang"})
		);

		expression_test_groups(t, re, "de", (res) => match(t, res, {language: "de"}));
		expression_test_groups(t, re, "de-CH", (res) => match(t, res, {language: "de", region: "CH"}));
		expression_test_groups(t, re, "de-CH-1901", 
			(res) => match(t, res, {language: "de", region: "CH", variant: "1901"})
		);

		expression_test_groups(t, re, "es-419", (res) => match(t, res, {language: "es", region: "419"}));
		expression_test_groups(t, re, "es-4192", (res) => match(t, res, {language: "es", variant: "4192"}));
		expression_test_groups(t, re, "es-41", should_fail);
		expression_test_groups(t, re, "es-90210", should_fail);

		expression_test_groups(t, re, "sl-IT-nedis",
			(res) => match(t, res, {language: "sl", region: "IT", variant: "nedis"})
		);
		expression_test_groups(t, re, "sl-IT-nedi", should_fail);

		expression_test_groups(t, re, "en-US-boont",
			(res) => match(t, res, {language: "en", region: "US", variant: "boont"})
		);

		expression_test_groups(t, re, "mn-Cyrl-MN", 
			(res) => match(t, res, {language: "mn", script: "Cyrl", region: "MN"})
		);
		expression_test_groups(t, re, "mn-cyrl-MN", should_fail);

		expression_test_groups(t, re, "x-fr-CH", 
			(res) => match(t, res, {privateUse1: "x-fr-CH"})
		);

		expression_test_groups(t, re, "en-GB-boont-r-extended-sequence-x-private", 
			(res) => match(t, res, {language: "en", region: "GB", variant: "boont", extension: "r-extended-sequence", privateUse2: "x-private"})
		);

		expression_test_groups(t, re, "sr-Cyrl", 
			(res) => match(t, res, {language: "sr", script: "Cyrl"})
		);
		expression_test_groups(t, re, "sr-Latn", 
			(res) => match(t, res, {language: "sr", script: "Latn"})
			);
		expression_test_groups(t, re, "hy-Latn-IT-arevela", 
			(res) => match(t, res, {language: "hy", script: "Latn", region: "IT", variant: "arevela"})
		);
		expression_test_groups(t, re, "zh-TW", 
			(res) => match(t, res, {language: "zh", region: "TW"}));
	})
});

