import { test, describe } from 'node:test';

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, extname } from 'path';

import fetchS from "sync-fetch"

import { xmlRegisterFsInputProviders } from "libxml2-wasm/lib/nodejs.mjs";
xmlRegisterFsInputProviders();

import { HasProperty } from "../lib/utils.mts";

const __dirname = import.meta.dirname

import ErrorList from "../lib/error_list.mts";

import ServiceListCheck from "../lib/sl_check.mts";
const sl_check = new ServiceListCheck({useURLs: false, async: false, verbose: false});

import PlaylistCheck from "../lib/playlist_check.mts";
const pl_check = new PlaylistCheck({useURLs: false, async: false, verbose: false});

import ContentGuideCheck from "../lib/cg_check.mts";
const cg_check = new ContentGuideCheck({useURLs: false, async: false, verbose: false});

import ServiceListRegistryCheck from "../lib/slr_check.mts";
import { GERMAN_A177r6_VARIANT } from '../lib/globals.mts';
const slr_check = new ServiceListRegistryCheck({useURLs: false, async: false, verbose: false});


const PASS = "pass", FAIL = "fail", UNTESTED = "untested";
const ENONET = 0x60;

type error_cardinality = {
	code: string
	count?: number
}
function matches(expect_list: error_cardinality[], actual_list: error_cardinality[], category: string): string[] {
	const rc: string[] = [];
	if (!expect_list && !actual_list) return rc;
	expect_list?.forEach((item) => {
		if (!HasProperty(item, "count")) item.count = 1;
		const actual_count = actual_list.filter((e) => e.code == item.code).length;
		if (actual_count != item.count)
			rc.push(`expected ${item.count} occurrences of ${category} code ${item.code}, but found ${actual_count}`);
	});
	actual_list?.forEach((item) => {
		if (!expect_list?.find((e) => e.code == item.code))
			rc.push(`unexpected ${category} code ${item.code} found in actual list`);
	});
	return rc;
}

function checkResults(errs: ErrorList, testFilename: string) : string {
	let test_status = UNTESTED;

	const expectFilename = testFilename.lastIndexOf(".xml") != -1 ? testFilename.substring(0, testFilename.lastIndexOf(".xml")) + ".expect.json" : null;
	if (expectFilename) {
		let expectData = null;
		try {
			expectData = readFileSync(expectFilename, { encoding: "utf8", flag: "r" })
		}
		// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
		catch (e) {}
		if (expectData) {
			const expectedResults = JSON.parse(expectData);
			
			if (expectedResults) {
				const issues = matches(expectedResults.fatals, errs.fatals, "fatal")
						.concat(matches(expectedResults.errors, errs.errors, "error"))
						.concat(matches(expectedResults.warnings, errs.warnings, "warning"))
						.concat(matches(expectedResults.debugs, errs.debugs, "debug"))
						.concat(matches(expectedResults.informationals, errs.informationals, "informational"));
				test_status = issues.length == 0	? PASS : FAIL;
				if (test_status == FAIL) {
					delete errs.markupXML;
					console.log(`test ${testFilename} failed`);
					console.dir(errs, { depth: null });
				}
			}
		}
	}
	return test_status
}

type test_result = {
	result: string
	errs: ErrorList
}

//all test invocation functions need the same prototype - CG tests have extra argument
//eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateSL(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	sl_check.doValidateServiceList(
		readFileSync(testFilename, { encoding: "utf8", flag: "r" }), 
		errs, 
		{ report_schema_version: false });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

//all test invocation functions need the same prototype - CG tests have extra argument
//eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateSL_Germany(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	sl_check.doValidateServiceList(
		readFileSync(testFilename, { encoding: "utf8", flag: "r" }), 
		errs,
		{ report_schema_version: false, variants: GERMAN_A177r6_VARIANT });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

//all test invocation functions need the same prototype - CG tests have extra argument
//eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateSLR(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	slr_check.doValidateServiceListRegistry(
		readFileSync(testFilename, { encoding: "utf8", flag: "r" }), 
		errs, 
		{ report_schema_version: false });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

//all test invocation functions need the same prototype - CG tests have extra argument
//eslint-disable-next-line @typescript-eslint/no-unused-vars
function validateSLR_Germany(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	slr_check.doValidateServiceListRegistry(
		readFileSync(testFilename, { encoding: "utf8", flag: "r" }), 
		errs, 
		{ report_schema_version: false, variants: GERMAN_A177r6_VARIANT });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

//all test invocation functions need the same prototype - CG tests have extra argument
//eslint-disable-next-line @typescript-eslint/no-unused-vars
function validatePL(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	pl_check.doValidatePlaylist(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), errs, { report_schema_version: false });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

function validateCG(testFilename: string, type: string | null = null) : test_result {
	const errs = new ErrorList();
	if (type)
		cg_check.doValidateContentGuide(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), type, errs, { report_schema_version: false });
	return {
		result: checkResults(errs, testFilename),
		errs: errs,
	}
}

type test_function = (testFilename: string, type: string | null) => test_result

function testIt(parentTest: test.TestContext, directories: string[], testFn: test_function, arg: string | null = null, skipReason: number | null | boolean = false) {
	if (!testFn) return

	if (directories.length == 0) {
		parentTest.todo();
		return;
	}

	directories.forEach((dir) => {
		parentTest.test(dir, (t) => {
			const actualDir = join(__dirname, dir)

			if (!existsSync(actualDir)) {
				t.skip(`directory ${actualDir} does not exist`);
				return;
			}
			const files = readdirSync(actualDir, {recursive: true}) as string[];
			files.forEach((file) => {
				if (extname(file) == ".xml")

					test(`${file}`, (t) => {
						if (skipReason == ENONET)
							t.skip(`skipped: network not available!`);
						else {
							const testResult = testFn(join(actualDir, file), arg);
							if (testResult.result == UNTESTED)
								t.todo(`todo: no expectation! ${testResult.errs.compactSummary()}`)
							else t.assert.equal(testResult.result, PASS, `src: ${join(dir,file)} ~~ ${testResult.errs.compactSummary()}`)
						}
					})
			})
		})
	})
}

function testItWtihNetwork(checkpoint: string, parentTest: test.TestContext, directories: string[], testFn: test_function, arg: string | null = null) {
	if (!testFn) return

	if (directories.length == 0) {
		parentTest.todo();
		return;
	}

	let resp = null;
	try {
		resp = fetchS(checkpoint, {timeout: 1000})
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
	catch (e) {};
	testIt(parentTest, directories, testFn, arg, resp?.ok ? null : ENONET)
}


test('DVB-I Tools with network', (t) => {
	t.test("Service Lists with Network", (tn) => {
		testItWtihNetwork("https://raw.githubusercontent.com/paulhiggs/dvb-i-tools.testsuite/refs/heads/main/res/DVB-logo-blue_1.png", tn, ["test-003-net/"], validateSL)
	})
})

describe('DVB-I Tools', () => {

	test("Service Lists", (t) => {
		testIt(t, ["test-002/", "test-003/", "test-006/SL/", "test-016/global/"], validateSL)
	})

	test("Service Lists (German Variant)", (t) => {
		testIt(t, ["test-016/germany/"], validateSL_Germany)
	})

	test("Service List Registry Responses", (t) => {
		testIt(t, ["test-005/","test-006/SLR/", "test-017/global/"], validateSLR)
	})

	test("Service List Registry (German Variant)", (t) => {
		testIt(t, ["test-017/germany/"], validateSLR_Germany)
	})

	test("Playists", (t) => {
		testIt(t, ["test-007/"], validatePL)
	})

	describe("Content Guide Metadata", () => {

		test("Schedule Time", (t) => {
			testIt(t, ["test-014/"], validateCG, "Time")
		})

		test("Schedule Now/Next", (t) => {
			testIt(t, ["test-008/"], validateCG, "NowNext")
		})

		test("Schedule Now/Next Window", (t) => {
			testIt(t, ["test-013/"], validateCG, "Window")
		})

		test("Program Info", (t) => {
			testIt(t, ["test-004/"], validateCG, "ProgInfo")
		})

		describe("Boxsets", () => {

			test("Categories", (t) => {
				testIt(t, ["test-009/"], validateCG, "bsCategories")
			})

			test("Lists", (t) => {
				testIt(t, ["test-010/"], validateCG, "bsLists")
			})

			test("Contents", (t) => {
				testIt(t, ["test-011/", "test-015/bsContents/"], validateCG, "bsContents")
			})
		})

		test("More Episodes", (t) => {
			testIt(t, ["test-012/"], validateCG, "MoreEpisodes")
		})
	})
})