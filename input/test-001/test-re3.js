// test regular expressions

import { doTest } from "./expression_test_common.mjs";

import {
	hasNonPrintableChars,
//	hasNonPrintableUnicodeChars,
	isASCII,
} from "../../../lib/pattern_checks.mjs";

const tests = [
	{item: "non-printable-01", fn: hasNonPrintableChars, evaluate: "Hello World", expect: false},
	{item: "non-printable-02", fn: hasNonPrintableChars, evaluate: "Hello\nWorld", expect: true},
	{item: "non-printable-03", fn: hasNonPrintableChars, evaluate: "Hello\tWorld", expect: true},
  {item: "non-printable-04", fn: hasNonPrintableChars, evaluate: "Hello\rWorld", expect: true},
	{item: "non-printable-05", fn: hasNonPrintableChars, evaluate: "tag", expect: false},
	{item: "non-printable-06", fn: hasNonPrintableChars, evaluate: "tagé", expect: true},
	{item: "non-printable-07", fn: hasNonPrintableChars, evaluate: "tag:dvb.org,2026:nvod-following:1", expect: false},

//	{item: "non-printable-unicode-01", fn: hasNonPrintableUnicodeChars, evaluate: "Hello World", expect: false},
//	{item: "non-printable-unicode-02", fn: hasNonPrintableUnicodeChars, evaluate: "Hello\nWorld", expect: true},
//	{item: "non-printable-unicode-03", fn: hasNonPrintableUnicodeChars, evaluate: "Hello\tWorld", expect: true},
//	{item: "non-printable-unicode-04", fn: hasNonPrintableUnicodeChars, evaluate: "Hello\rWorld", expect: true},
//	{item: "non-printable-unicode-05", fn: hasNonPrintableUnicodeChars, evaluate: "tag", expect: false},
//	{item: "non-printable-unicode-06", fn: hasNonPrintableUnicodeChars, evaluate: "tagé", expect: false},
//	{item: "non-printable-unicode-07", fn: hasNonPrintableUnicodeChars, evaluate: "tag:dvb.org,2026:nvod-following:1", expect: false},

	{item: "isASCII-01", fn: isASCII, evaluate: "tag:dvb.org,2026:nvod-following:1", expect: true},
	{item: "isASCII-02", fn: isASCII, evaluate: "tagé", expect: false},
];

tests.forEach((test) => doTest(test));
