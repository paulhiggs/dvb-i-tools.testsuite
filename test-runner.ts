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

import ServiceListCheck from "../lib/sl_check.mts";
import ContentGuideCheck from "../lib/cg_check.mts";
import ServiceListRegistryCheck from "../lib/slr_check.mts";
import { isHTTPURL } from "../lib/pattern_checks.mts";

import ErrorList from "../lib/error_list.mts";

// parse command line options
const optionDefinitions = [
	{ name: "urls", alias: "u", type: Boolean, defaultValue: false, description: "Load data files from network locations." },
	{ name: "mode", alias: "m", type: String, typeLabel: "{underline type}", description: "Type of validation to perform on the specified sources" },
	{ name: "nomarkup", type: Boolean, defaultValue: false, description: "Only include error list, no document markup" },
	{ name: "src", type: String, multiple: true, defaultOption: true, typeLabel: "{underline filenames and/or URLs}", description: "Source files to validate" },
	{ name: "help", alias: "h", type: Boolean, defaultValue: false, description: "This help" },
];

const SIdescription = (mode : string) => `Validate the source files as Schedule Information (${mode}) responses`;
const BSdescription = (mode : string) => `Validate the source files as Box Set ${mode} responses`;

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

if (options.mode.toLowerCase() == "sl") {
	// test a service list
	const sl = new ServiceListCheck(options.urls, null, false);
	options.src.forEach((ref) => {
		let SLtext = null;
		if (isHTTPURL(ref)) {
			let resp = null;
			try {
				resp = fetchS(ref.body.XMLurl);
			} catch (error) {
				console.log(chalk.red(error.message));
			}
			if (resp) {
				if (resp.ok) SLtext = resp.content;
				else console.log(chalk.red(`error (${resp.status}:${resp.statusText}) handling ${ref}`));
			}
		} else SLtext = readFileSync(ref, { encoding: "utf8", flag: "r" });

		const errs = new ErrorList();
		sl.doValidateServiceList(SLtext, errs, { report_schema_version: false });
		console.log(`\n${ref}\n${"".padStart(ref.length, "=")}\n`);
		if (options.nomarkup) delete errs.markupXML;
		console.log(JSON.stringify({ errs }, null, 2));
	});
} else if  (options.mode.toLowerCase() == "slr") {
	// test a a service list registry response
	const slr = new ServiceListRegistryCheck(options.urls, null, false);
	options.src.forEach((ref) => {
		let SLRtext = null;
		if (isHTTPURL(ref)) {
			let resp = null;
			try {
				resp = fetchS(ref.body.XMLurl);
			} catch (error) {
				console.log(chalk.red(error.message));
			}
			if (resp) {
				if (resp.ok) SLRtext = resp.content;
				else console.log(chalk.red(`error (${resp.status}:${resp.statusText}) handling ${ref}`));
			}
		} else SLRtext = readFileSync(ref, { encoding: "utf8", flag: "r" });

		const errs = new ErrorList();
		slr.doValidateServiceListRegistry(SLRtext, errs, { report_schema_version: false });
		console.log(`\n${ref}\n${"".padStart(ref.length, "=")}\n`);
		if (options.nomarkup) delete errs.markupXML;
		console.log(JSON.stringify({ errs }, null, 2));
	});
} else if (options.mode.toLowerCase().substring(0, 2) == "cg") {
	// test a content guide document
	if (options.mode.indexOf("-") == -1) {
		console.log(chalk.red(`content guide request type must be specified`));
		process.exit(1);
	}
	const cg = new ContentGuideCheck(options.urls, null, false);
	const cg_request = options.mode.substring(options.mode.indexOf("-") + 1);
	const req = cg.supportedRequests.find((s) => s.value == cg_request);
	if (req == undefined) {
		console.log(chalk.red(`"${cg_request}" is not a supported content guide requet type`));
		process.exit(1);
	}
	options.src.forEach((ref) => {
		let CGtext = null;
		if (isHTTPURL(ref)) {
			let resp = null;
			try {
				resp = fetchS(req.body.XMLurl);
			} catch (error) {
				console.log(chalk.red(error.message));
			}
			if (resp) {
				if (resp.ok) CGtext = resp.content;
				else console.log(chalk.red(`error (${resp.status}:${resp.statusText}) handling ${ref}`));
			}
		} else CGtext = readFileSync(ref, { encoding: "utf8", flag: "r" });

		const errs = new ErrorList();
		cg.doValidateContentGuide(CGtext, cg_request, errs, { report_schema_version: false });
		console.log(`\n${ref}\n${"".padStart(ref.length, "=")}\n`);
		if (options.nomarkup) delete errs.markupXML;
		console.log(JSON.stringify({ errs }, null, 2));
	});
} else {
	console.log(chalk.red("test mode not specified"));
}
