/**
 * test-runner.js
 *
 * An standalone runner for tests
 */
import { readFileSync } from "fs";
import process from "process";

import chalk from "chalk";
import commandLineArgs from "command-line-args";
import commandLineUsage from "command-line-usage";
import fetchS from "sync-fetch";

import { xmlRegisterFsInputProviders } from "libxml2-wasm/lib/nodejs.mjs";
xmlRegisterFsInputProviders();

import { Libxml2_wasm_init } from "../libxml2-wasm-extensions.mjs";
Libxml2_wasm_init();

import ServiceListCheck from "../lib/sl_check.mjs";
import PlaylistCheck from "../lib/playlist_check.mjs";
import ContentGuideCheck from "../lib/cg_check.mjs";
import ServiceListRegistryCheck from "../lib/slr_check.mjs";
import { isHTTPURL } from "../lib/pattern_checks.mjs";
import { fetch_options } from "../lib/globals.mjs";
import ErrorList from "../lib/error_list.mjs";


// parse command line options
const optionDefinitions = [
	{ name: "urls", alias: "u", type: Boolean, defaultValue: false, description: "Load data files from network locations." },
	{ name: "mode", alias: "m", type: String, typeLabel: "{underline type}", description: "Type of validation to perform on the specified sources" },
	{ name: "nomarkup", type: Boolean, defaultValue: false, description: "Only include error list, no document markup" },
	{ name: "src", type: String, multiple: true, defaultOption: true, typeLabel: "{underline filenames and/or URLs}", description: "Source files to validate" },
	{ name: "soe", type: Boolean, defaultValue: false, description: "Stop on first error" },
	{ name: "help", alias: "h", type: Boolean, defaultValue: false, description: "This help" },
];

let SIdescription = (mode) => `Validate the source files as Schedule Information (${mode}) responses`;
let BSdescription = (mode) => `Validate the source files as Box Set ${mode} responses`;

const commandLineHelp = [
	{
		header: "Regression test of DVB Service List and Content Guide validator",
		content: "Regression tests for syntax and semantic validation of XML documents defined in DVB Blueblook A177 (DVB-I)",
	},
	{
		header: "Synopsis",
		content: "$ node test-runner <options>",
	},
	{
		header: "Options",
		optionList: optionDefinitions,
	},
	{
		header: "Values for mode",
		content: [
			{ name: "sl", summary: "Validate source files as Service Lists" },
			{ name: "pl", summary: "Validate source files as Playlists" },
			{ name: "slr", summary: "Validate source files as Service Lists Registry responses" },
			{ name: "cg-Time", summary: SIdescription("time stamp") },
			{ name: "cg-NowNext", summary: SIdescription("now/next") },
			{ name: "cg-Window", summary: SIdescription("window") },
			{ name: "cg-ProgInfo", summary: "Validate the source files as Program Information responses" },
			{ name: "cg-MoreEpisosea", summary: "Validate the source files as More Episodes responses" },
			{ name: "cg-bsCategories", summary: BSdescription("Categories") },
			{ name: "cg-bsLists", summary: BSdescription("Lists") },
			{ name: "cg-bsContents", summary: BSdescription("Contents") },
		],
	},
	{
		header: "About",
		content: "Project home: {underline https://github.com/paulhiggs/dvb-i-tools/}",
	},
];

const options = commandLineArgs(optionDefinitions);

if (options.help) {
	console.log(commandLineUsage(commandLineHelp));
	process.exit(0);
}

if (!options.src || options.src.length == 0) {
	console.log(chalk.red("no files specified to validate, exiting..."));
	process.exit(1);
}


function readFile(ref) {
	try {
		return readFileSync(ref, { encoding: "utf8", flag: "r" });
	} 
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	catch (error) {
		//console.log(chalk.red(`error reading file ${ref}: ${error.message}`));
	}
	return null;
}


function readURL(ref) {
		let resp = null;
		try {
			resp = fetchS(ref.body.XMLurl, fetch_options);
		} catch (error) {
			console.log(chalk.red(error.message));
		}
		if (resp && !resp.ok)
 			console.log(chalk.red(`error (${resp.status}:${resp.statusText}) handling ${ref}`));
		return resp ? resp.text() : null;
}


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

const PASS = 1, FAIL = 2, UNTESTED = 3;

const statistics_t = [
	{ result: PASS, count: 0, description: "test passed with expected errors/warnings" },
	{ result: FAIL, count: 0, description: "test failed with unexpected errors/warnings, or expected errors/warnings not found" },
	{ result: UNTESTED, count: 0, description: "test result not evaluated due to missing expected results data" },
];

class Statistics {
	constructor() {
		this.stats = {};
		statistics_t.forEach((s) => this.stats[s.result] = { count: 0, description: s.description });
	}

	increment(result) {
		if (this.stats[result]) this.stats[result].count++;
	}

	report() {
		const lines = [];
		Object.keys(this.stats).forEach((key) => {
			const s = this.stats[key];
			lines.push(`${s.count} tests ${s.description}`);
		});
		return lines.join("\n");
	}
}


function report(ref, errs) {
	let test_status = UNTESTED, issues = [];
	const expect_data = ref.lastIndexOf(".xml") != -1 ? ref .substring(0 ,ref.lastIndexOf(".xml")) + ".expect.json" : null;
	if (expect_data) {
		const expect = JSON.parse(isHTTPURL(expect_data)? readURL(expect_data) : readFile(expect_data));
		if (expect) {
			issues = matches(expect.fatals, errs.fatals, "fatal")
					.concat(matches(expect.errors, errs.errors, "error"))
					.concat(matches(expect.warnings, errs.warnings, "warning"))
					.concat(matches(expect.debugs, errs.debugs, "debug"))
					.concat(matches(expect.informationals, errs.informationals, "informational"));
			test_status = issues.length == 0	? PASS : FAIL;
		}
	}
	if (test_status == PASS) console.log(chalk.green(`${ref} --> TEST OK`));
	else if (test_status == FAIL) {
		console.log(chalk.red(`${ref} --> TEST FAIL`));
		issues.forEach((issue) => console.log(chalk.red(`  ${issue}`)));
		if (options.nomarkup) delete errs.markupXML;
		console.log(chalk.red(JSON.stringify({ errs }, null, 2)));
	}
	else {
		console.log(`\n${ref}\n${"".padStart(ref.length, "=")}`);
		if (options.nomarkup) delete errs.markupXML;
		console.log(JSON.stringify({ errs }, null, 2));
	}
	return test_status;
}

const stats = new Statistics();
if (options.mode.toLowerCase() == "sl") {
	// test a service list
	const sl = new ServiceListCheck(options.urls, null, false);
	options.src.forEach((ref) => {
		const SLtext = isHTTPURL(ref) ? readURL(ref) : readFile(ref);
		const errs = new ErrorList();
		sl.doValidateServiceList(SLtext, errs, { report_schema_version: false });
		const test_status = report(ref, errs);
		stats.increment(test_status);
		if (test_status == FAIL && options.soe) {
			console.log(chalk.cyan(`Stopping on first error as requested`));
			process.exit(1);
		}
	});
	console.log(chalk.cyan(`Test results:\n${stats.report()}\n`));
} 
else if (options.mode.toLowerCase() == "pl") {
	// test playlist
	const pl = new PlaylistCheck(options.urls, null, false);
	options.src.forEach((ref) => {
		const PLtext = isHTTPURL(ref) ? readURL(ref) : readFile(ref);
		const errs = new ErrorList();
		pl.doValidatePlaylist(PLtext, errs, { report_schema_version: false });
		const test_status = report(ref, errs);
		stats.increment(test_status);
		if (test_status == FAIL && options.soe) {
			console.log(chalk.cyan(`Stopping on first error as requested`));
			process.exit(1);
		}
	});
	console.log(chalk.cyan(`Test results:\n${stats.report()}\n`));
}
else if  (options.mode.toLowerCase() == "slr") {
	// test a a service list registry response
	const slr = new ServiceListRegistryCheck(options.urls, null, false);
	options.src.forEach((ref) => {
		const SLRtext = isHTTPURL(ref) ? readURL(ref) : readFile(ref);
		const errs = new ErrorList();
		slr.doValidateServiceListRegistry(SLRtext, errs, { report_schema_version: false });
		const test_status = report(ref, errs);
		stats.increment(test_status);
		if (test_status == FAIL && options.soe) {
			console.log(chalk.cyan(`Stopping on first error as requested`));
			process.exit(1);
		}
	});
	console.log(chalk.cyan(`Test results:\n${stats.report()}\n`));
} 
else if (options.mode.toLowerCase().substring(0, 2) == "cg") {
	// test a content guide document
	if (options.mode.indexOf("-") == -1) {
		console.log(chalk.red(`content guide request type must be specified`));
		process.exit(1);
	}
	const cg = new ContentGuideCheck(options.urls, null, false);
	const cg_request = options.mode.substring(options.mode.indexOf("-") + 1);
	const req = cg.supportedRequests.find((s) => s.value == cg_request);
	if (req == undefined) {
		console.log(chalk.red(`"${cg_request}" is not a supported content guide request type`));
		process.exit(1);
	}
	options.src.forEach((ref) => {
		const CGtext = isHTTPURL(ref) ? readURL(ref) : readFile(ref);
		const errs = new ErrorList();
		cg.doValidateContentGuide(CGtext, cg_request, errs, { report_schema_version: false });
		const test_status = report(ref, errs);
		stats.increment(test_status);
		if (test_status == FAIL && options.soe) {
			console.log(chalk.cyan(`Stopping on first error as requested`));
			process.exit(1);
		}
	});
	console.log(chalk.cyan(`Test results:\n${stats.report()}\n`));
} 
else if (options.mode.toLowerCase() == "individual") {
	const sl = new ServiceListCheck(options.urls, null, false);	
	const pl = new PlaylistCheck(options.urls, null, false);
	const slr = new ServiceListRegistryCheck(options.urls, null, false);
	const cg = new ContentGuideCheck(options.urls, null, false);

	const sources = readFile(options.src[0]).split('\n');

	sources.forEach((testcase) => {

		const wrap = testcase.split(/(\[(.+)\])(.*)/);
		const testtype = wrap[2], testdoc=wrap[3];
		const text = isHTTPURL(testdoc) ? readURL(testdoc) : readFile(testdoc);
		const errs = new ErrorList();

		if (testtype && testdoc) {
			if (testtype.toLowerCase() == "sl")
				sl.doValidateServiceList(text, errs, { report_schema_version: false });
			else if (testtype.toLowerCase() == "pl")
				pl.doValidatePlaylist(text, errs, { report_schema_version: false });	
			else if (testtype.toLowerCase() == "slr")
				slr.doValidateServiceListRegistry(text, errs, { report_schema_version: false });
			else if (testtype.toLowerCase().substring(0, 2) == "cg") {
				const cg_request = testtype.substring(testtype.indexOf("-") + 1);
				const req = cg.supportedRequests.find((s) => s.value == cg_request);
				if (req == undefined) {
					console.log(chalk.red(`"${cg_request}" is not a supported content guide request type`));
					process.exit(1);
				}
				cg.doValidateContentGuide(text, cg_request, errs, { report_schema_version: false });
			}

			const test_status = report(testdoc, errs);
			stats.increment(test_status);
			if (test_status == FAIL && options.soe) {
				console.log(chalk.cyan(`Stopping on first error as requested`));
				process.exit(1);
			}
		}
	});
	console.log(chalk.cyan(`Test results:\n${stats.report()}\n`));
}
else {
	console.log(chalk.red("test mode not specified"));
}
