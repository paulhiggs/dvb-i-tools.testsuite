// test regular expressions

import { doTest } from "./expression_test_common.mjs";

import { isMIME } from "../../../lib/MIME_checks.mjs";
import { dvbi } from "../../../lib/DVB-I_definitions.mjs";

const tests = [
	{ item: "AIT", fn: isMIME, evaluate: dvbi.XML_AIT_CONTENT_TYPE, expect: true },
	{ item: "HTML5 App", fn: isMIME, evaluate: dvbi.HTML5_APP, expect: true },
	{ item: "XHTML App", fn: isMIME, evaluate: dvbi.XHTML_APP, expect: true },
	{ item: "XML App", fn: isMIME, evaluate: dvbi.XML_APP, expect: true },
	{ item: "JPEG", fn: isMIME, evaluate: "image/jpeg", expect: true },
	{ item: "PNG", fn: isMIME, evaluate: "image/png", expect: true },
];
tests.forEach((test) => doTest(test));
