// test BCP47 language related regular expressions

import { BCP47_Language_Tag } from "../../../lib/pattern_checks.mjs";
import { isValidLangFormat } from "../../../lib/IANA_languages.mjs";

import { doTest } from "./expression_test_common.mjs";

const tests_language = [
	{ item: "Language 001", pattern: BCP47_Language_Tag, evaluate: "eng", expect: true },
	{ item: "Language 002", pattern: BCP47_Language_Tag, evaluate: "english", expect: true },
	{ item: "Language 003", pattern: BCP47_Language_Tag, evaluate: "engl!sh", expect: false },
	{ item: "Language 004 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-Hant-CN-x-private1-private2", expect: true },
	{ item: "Language 005 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-Hant-CN-x-private1", expect: true },
	{ item: "Language 006 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-Hant-CN", expect: true },
	{ item: "Language 007a (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-Hant", expect: true },
	{ item: "Language 007b (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-hant", expect: false },
	{ item: "Language 008 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh", expect: true },

	{ item: "Language 009", pattern: BCP47_Language_Tag, evaluate: "zh-Hant-CN-x-", expect: false },
	{ item: "Language 010", pattern: BCP47_Language_Tag, evaluate: "zh-Hant-CN-x", expect: false },
	{ item: "Language 011", pattern: BCP47_Language_Tag, evaluate: "zh-", expect: false },
	{ item: "Language 012", fn: isValidLangFormat, evaluate: "zh-ziang", expect: true },

	{ item: "Language 013 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "de", expect: true },
	{ item: "Language 014 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "de-CH", expect: true },
	{ item: "Language 015 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "de-CH-1901", expect: true },
	{ item: "Language 016a (BCP47)", pattern: BCP47_Language_Tag, evaluate: "es-419", expect: true },
	{ item: "Language 016b (BCP47)", pattern: BCP47_Language_Tag, evaluate: "es-4192", expect: true },
	{ item: "Language 016c (BCP47)", pattern: BCP47_Language_Tag, evaluate: "es-41", expect: false },
	{ item: "Language 016d (BCP47)", pattern: BCP47_Language_Tag, evaluate: "es-90210", expect: false },
	{ item: "Language 017 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "sl-IT-nedis", expect: true },
	{ item: "Language 018 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "en-US-boont", expect: true },
	{ item: "Language 019 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "mn-Cyrl-MN", expect: true },
	{ item: "Language 020 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "x-fr-CH", expect: true },
	{ item: "Language 021 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "en-GB-boont-r-extended-sequence-x-private", expect: true },
	{ item: "Language 022 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "sr-Cyrl", expect: true },
	{ item: "Language 023 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "sr-Latn", expect: true },
	{ item: "Language 024 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "hy-Latn-IT-arevela", expect: true },
	{ item: "Language 025 (BCP47)", pattern: BCP47_Language_Tag, evaluate: "zh-TW", expect: true },


];

tests_language.forEach((test) => doTest(test));
