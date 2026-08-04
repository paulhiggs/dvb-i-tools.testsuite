import test from 'node:test';

import { readFileSync, readdir, readdirSync } from 'fs';
import { join, extname } from 'path';

import { xmlRegisterFsInputProviders } from "libxml2-wasm/lib/nodejs.mjs";
xmlRegisterFsInputProviders();

import { Libxml2_wasm_init } from "../../libxml2-wasm-extensions.mjs";
Libxml2_wasm_init();


const __dirname = import.meta.dirname

import ErrorList from "../../lib/error_list.mjs";

import ServiceListCheck from "../../lib/sl_check.mjs";
const sl_check = new ServiceListCheck({useURLs: false,async: false, verbose: false});

import PlaylistCheck from "../../lib/playlist_check.mjs";
const pl_check = new PlaylistCheck({useURLs: false,async: false, verbose: false});

import ContentGuideCheck from "../../lib/cg_check.mjs";
const cg_check = new ContentGuideCheck({useURLs: false,async: false, verbose: false});

import ServiceListRegistryCheck from "../../lib/slr_check.mjs";
const slr_check = new ServiceListRegistryCheck({useURLs: false,async: false, verbose: false});


const PASS = 1, FAIL = 2, UNTESTED = 3;

function matches(expect_list, actual_list, category) {
	if (!expect_list && !actual_list) return true;
	let rc = [];
	expect_list?.forEach((item) => {
		if (!Object.prototype.hasOwnProperty.call(item, "count")) item.count = 1;
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

function checkResults(errs, testFilename) {
	let test_status = UNTESTED, issues = [];
	const expectFilename = testFilename.lastIndexOf(".xml") != -1 ? testFilename.substring(0, testFilename.lastIndexOf(".xml")) + ".expect.json" : null;
	if (expectFilename) {
		let expectData = null;
		try {
			expectData = readFileSync(expectFilename, { encoding: "utf8", flag: "r" })
		}
		catch (e) {}
		if (expectData) {
			const expectedResults = JSON.parse(expectData);
			
			if (expectedResults) {
				issues = matches(expectedResults.fatals, errs.fatals, "fatal")
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


function validateSL(testFilename) {
	const errs = new ErrorList();
	sl_check.doValidateServiceList(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), errs, { report_schema_version: false });
	return checkResults(errs, testFilename)
}

function validateSLR(testFilename) {
	const errs = new ErrorList();
	slr_check.doValidateServiceListRegistry(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), errs, { report_schema_version: false });
	return checkResults(errs, testFilename)
}

function validatePL(testFilename) {
	const errs = new ErrorList();
	pl_check.doValidatePlaylist(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), errs, { report_schema_version: false });
	return checkResults(errs, testFilename)
}

function validateCG(testFilename, type) {
	const errs = new ErrorList();
	cg_check.doValidateContentGuide(readFileSync(testFilename, { encoding: "utf8", flag: "r" }), type, errs, { report_schema_version: false });
	return checkResults(errs, testFilename)
}

function testIt(parentTest, directories, testFn = null, arg = null) {
	if (!testFn) return

	if (directories.length == 0) {
		parentTest.todo();
		return;
	}

	directories.forEach((dir) => {
		parentTest.test(dir, (t) => {
			const actualDir = join(__dirname, "..", dir)
			const files = readdirSync(actualDir, {recursive: true});
			files.forEach((file) => {
					if (extname(file) == ".xml") {

						test(`${file}`, (t) => {
							const testResult = testFn(join(actualDir, file), arg);
							if (testResult == UNTESTED) {
								t.skip(file)
							}
							else t.assert.strictEqual(testResult, PASS, `src: ${join(dir,file)}`)
						})

					}
			})
		})
	})
}


test('DVB-I Tools', (t) => {

	t.test("Service Lists", (t) => {
		testIt(t, ["input/test-002/", "input/test-003/", "input/test-006/SL"], validateSL)
	})

	t.test("Service List Registry Responses", (t) => {
		testIt(t, ["input/test-005/","input/test-006/SLR"], validateSLR)
	})

	t.test("Playists", (t) => {
		testIt(t, ["input/test-007/"], validatePL)
	})

	t.test("Content Guide Metadata", (t) => {

		t.test("Schedule Time", (t) => {
			testIt(t, ["input/test-014"], validateCG, "Time")
		})

		t.test("Schedule Now/Next", (t) => {
			testIt(t, ["input/test-008"], validateCG, "NowNext")
		})

		t.test("Schedule Now/Next Window", (t) => {
			testIt(t, ["input/test-013"], validateCG, "Window")
		})

		t.test("Program Info", (t) => {
			testIt(t, ["input/test-004"], validateCG, "ProgInfo")
		})

		t.test("Boxsets", (t) => {

			t.test("Categories", (t) => {
				testIt(t, ["input/test-009"], validateCG, "bsCategories")
			})

			t.test("Lists", (t) => {
				testIt(t, ["input/test-010"], validateCG, "bsLists")
			})

			t.test("Contents", (t) => {
				testIt(t, ["input/test-011", "input/test-015/bsContents"], validateCG, "bsContents")
			})
		})

		t.test("More Episodes", (t) => {
			testIt(t, ["input/test-012"], validateCG, "MoreEpisodes")
		})
	})
})