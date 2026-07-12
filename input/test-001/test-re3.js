// test regular expressions

import { doTest } from "./expression_test_common.mjs";

import {
	hasNonPrintableChars,
	//PrintableCharsOnly,
	isASCII,
} from "../../../lib/pattern_checks.mjs";

const tests = [
	//{item: "non-printable-01", fn: hasNonPrintableChars, evaluate: "Hello World", expect: false},
	{item: "non-printable-02", fn: hasNonPrintableChars, evaluate: "Hello\nWorld", expect: true},
	{item: "non-printable-03", fn: hasNonPrintableChars, evaluate: "Hello\tWorld", expect: true},
  {item: "non-printable-04", fn: hasNonPrintableChars, evaluate: "Hello\rWorld", expect: true},

	//{item: "printable-01", fn: PrintableCharsOnly, evaluate: "tag", expect: true},
	//{item: "printable-02", fn: PrintableCharsOnly, evaluate: "tagé", expect: true},
	//{item: "printable-03", fn: PrintableCharsOnly, evaluate: "tag:dvb.org,2026:nvod-following:1", expect: true},

	{item: "isASCII-01", fn: isASCII, evaluate: "tag:dvb.org,2026:nvod-following:1", expect: true},
	{item: "isASCII-02", fn: isASCII, evaluate: "tagé", expect: false},
];

tests.forEach((test) => doTest(test));
