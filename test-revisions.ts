/**
 * test-revisions.ts
 *
 *  DVB-I-tools
 *  Copyright (c) 2021-2026, Paul Higgs
 *  BSD-2-Clause license, see LICENSE.txt file
 *
 * The revisions of A177 and of TV-Anytime (dvb-i-tools #125): the operators within a specification, known, and the uses
 * that must not compile. Those are marked // @ts-expect-error, so `npm run typecheck` fails if one of them ever compiles.
 * And the revision in the name of each test document is the one its namespaces give
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { inspect } from "node:util"
import { readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"

import { A177Revision, TVARevision } from "../lib/revisions.mts"
import { slVersions, cgVersions, dvbi, dvbisld } from "../lib/DVB-I_definitions.mts"
import { TVAschema } from "../lib/data_locations.mts"
import { SL_SchemaVersion } from "../lib/sl_data_versions.mts"
import { SLR_SchemaVersion } from "../lib/slr_data_versions.mts"
import { CG_SchemaVersion } from "../lib/cg_check.mts"

// a revision of each specification, typed as its class (as the *_SchemaVersion() functions return them)
const slVersion: A177Revision = slVersions.r6
const cgVersion: TVARevision = cgVersions.r2

describe("Revisions", () => {
	describe("The tables", () => {
		test("slVersions and cgVersions are the revision classes", () => {
			assert.equal(slVersions, A177Revision)
			assert.equal(cgVersions, TVARevision)
		})
		test("A177 has r0 to r8, and TV-Anytime r0 to r3", () => {
			assert.deepEqual(A177Revision.all.map((r) => r.level), [0, 1, 2, 3, 4, 5, 6, 7, 8])
			assert.deepEqual(TVARevision.all.map((r) => r.level), [0, 1, 2, 3])
		})
		test("the latest revision of each", () => {
			assert.equal(A177Revision.latest, slVersions.r8)
			assert.equal(TVARevision.latest, cgVersions.r3)
		})
		test("unknown has the level -1", () => {
			assert.equal(slVersions.unknown.level, -1)
			assert.equal(cgVersions.unknown.level, -1)
		})
		test("the names", () => {
			assert.deepEqual([slVersions.r0.label, slVersions.r6.label, slVersions.unknown.label], ["A177", "A177r6", "A177 (unknown revision)"])
			assert.deepEqual([cgVersions.r3.label, cgVersions.unknown.label], ["TV-Anytime r3", "TV-Anytime (unknown revision)"])
			assert.equal(slVersions.r6.specification, "A177")
			assert.equal(cgVersions.r3.specification, "TV-Anytime")
		})
	})

	describe("The operators", () => {
		test("< <= > >= compare the levels", () => {
			assert.ok(slVersions.r6 < slVersions.r7 && !(slVersions.r7 < slVersions.r6) && !(slVersions.r6 < slVersions.r6))
			assert.ok(slVersions.r6 <= slVersions.r6 && slVersions.r6 <= slVersions.r7 && !(slVersions.r7 <= slVersions.r6))
			assert.ok(slVersions.r8 > slVersions.r0 && !(slVersions.r0 > slVersions.r8) && !(slVersions.r8 > slVersions.r8))
			assert.ok(cgVersions.r3 >= cgVersions.r3 && cgVersions.r3 >= cgVersions.r2 && !(cgVersions.r2 >= cgVersions.r3))
		})
		test("unknown is lower than every revision", () => {
			for (const r of A177Revision.all) assert.ok(slVersions.unknown < r, r.label)
			for (const r of TVARevision.all) assert.ok(cgVersions.unknown < r, r.label)
		})
		test("== and != are the same revision", () => {
			assert.ok(slVersions.r6 == slVersions.r6 && slVersions.r6 != slVersions.r7)
			assert.ok(cgVersions.unknown == cgVersions.unknown && cgVersions.r0 != cgVersions.unknown)
		})
		test("the example of the issue", () => {
			const check = (cg: TVARevision, sl: A177Revision) => cg < cgVersions.r3 || sl < slVersions.r7
			assert.equal(check(cgVersions.r2, slVersions.r8), true)
			assert.equal(check(cgVersions.r3, slVersions.r6), true)
			assert.equal(check(cgVersions.r3, slVersions.r7), false)
		})
		test("switch / case", () => {
			const name = (r: A177Revision) => {
				switch (r) {
					case slVersions.r6:
						return "six"
					case slVersions.r7:
						return "seven"
					default:
						return "other"
				}
			}
			assert.deepEqual([name(slVersions.r6), name(slVersions.r7), name(slVersions.r8)], ["six", "seven", "other"])
		})
		test("in a string, a revision is its level", () => {
			// as in the error codes of schema validation (e.g. CG003:3) and in messages (A177r6)
			assert.equal(`CG003:${cgVersions.r3}`, "CG003:3")
			assert.equal(`A177r${slVersions.r6}`, "A177r6")
			assert.equal(String(slVersions.unknown), "-1")
			assert.equal("SL" + slVersions.r5, "SL5")
		})
		test("in JSON, a revision is its level", () => assert.equal(JSON.stringify({ sl: slVersions.r8, cg: cgVersions.r3 }), '{"sl":8,"cg":3}'))
		test("console.log shows its name", () => assert.equal(inspect(slVersions.r6), "A177r6"))
	})

	describe("known", () => {
		test("every revision is known, and unknown is not", () => {
			assert.ok(A177Revision.all.every((r) => r.known) && TVARevision.all.every((r) => r.known))
			assert.equal(slVersions.unknown.known, false)
			assert.equal(cgVersions.unknown.known, false)
		})
	})

	// the TV-Anytime revision imported by the service list schema of each A177 revision (dvb-i-tools #128)
	describe("The TV-Anytime revision of each A177 revision", () => {
		test("as imported by the service list schemas", () => {
			const imported = A177Revision.all.map((r) => [r.label, r.tvAnytime.label])
			assert.deepEqual(imported, [
				["A177", "TV-Anytime r0"], // dvbi_v1.0.xsd: TV-Anytime 2019
				["A177r1", "TV-Anytime r0"],
				["A177r2", "TV-Anytime r0"],
				["A177r3", "TV-Anytime r0"],
				["A177r4", "TV-Anytime r0"], // dvbi_v4.0.xsd: TV-Anytime 2019
				["A177r5", "TV-Anytime r1"], // dvbi_v5.0.xsd: TV-Anytime 2023
				["A177r6", "TV-Anytime r2"], // dvbi_v6.0.xsd: TV-Anytime 2024
				["A177r7", "TV-Anytime r2"], // dvbi_v7.0.xsd: TV-Anytime 2024
				["A177r8", "TV-Anytime r3"], // dvbi_v8.0.xsd: TV-Anytime 2026
			])
		})
		test("the latest A177 revision imports the latest TV-Anytime revision", () => assert.equal(A177Revision.latest.tvAnytime, TVARevision.latest))
		test("the TV-Anytime revisions follow the A177 revisions", () => {
			for (let i = 1; i < A177Revision.all.length; i++) assert.ok(A177Revision.all[i - 1].tvAnytime <= A177Revision.all[i].tvAnytime, A177Revision.all[i].label)
		})
		test("an unknown A177 revision imports an unknown TV-Anytime revision", () => assert.equal(slVersions.unknown.tvAnytime, cgVersions.unknown))
		test("a service list's namespace gives its TV-Anytime revision", () => {
			assert.equal(SL_SchemaVersion(dvbi.A177r8_Namespace).tvAnytime, cgVersions.r3)
			assert.equal(SL_SchemaVersion(dvbi.A177r7_Namespace).tvAnytime, cgVersions.r2)
		})
	})

	describe("The schema versions of documents", () => {
		test("a service list, registry and content guide namespace give their revisions", () => {
			assert.equal(SL_SchemaVersion(dvbi.A177r8_Namespace), slVersions.r8)
			assert.equal(SL_SchemaVersion(dvbi.A177r6_Namespace), slVersions.r6)
			assert.equal(SLR_SchemaVersion(dvbisld.A177r8_Namespace), slVersions.r8)
			assert.equal(CG_SchemaVersion(TVAschema.v2027.namespace), cgVersions.r3)
			assert.equal(CG_SchemaVersion(TVAschema.v2024.namespace), cgVersions.r2)
		})
		test("an unrecognised namespace is unknown", () => {
			assert.equal(SL_SchemaVersion("urn:example:none"), slVersions.unknown)
			assert.equal(CG_SchemaVersion("urn:example:none"), cgVersions.unknown)
		})
	})

	// each line below must be a compile error. They are only checked by the compiler (npm run typecheck): what they would do
	// at run time does not matter
	describe("Uses that do not compile", () => {
		test("comparing revisions of the two specifications", () => {
			// @ts-expect-error TS2365: a TV-Anytime revision compared with an A177 revision
			void (cgVersion < slVersions.r7)
			// @ts-expect-error TS2365
			void (slVersion >= cgVersions.r3)
			// @ts-expect-error TS2365
			void (slVersion > cgVersion)
			// @ts-expect-error TS2365
			void (cgVersion <= slVersion)
			// @ts-expect-error TS2367
			void (cgVersion == slVersions.r7)
			// @ts-expect-error TS2367
			void (slVersion != cgVersions.r3)
			// @ts-expect-error TS2367
			void (slVersion === cgVersion)
		})
		test("comparing a revision with a number", () => {
			// @ts-expect-error TS2365: use the named revisions
			void (cgVersion < 3)
			// @ts-expect-error TS2365
			void (slVersion >= 6)
			// @ts-expect-error TS2367
			void (slVersion == 6)
		})
		test("arithmetic and bitwise operators", () => {
			// @ts-expect-error TS2365: revisions are only compared
			void (slVersion + 1)
			// @ts-expect-error TS2362
			void (slVersion - 1)
			// @ts-expect-error TS2362
			void (slVersion - slVersions.r0)
			// @ts-expect-error TS2362
			void (slVersion * 2)
			// @ts-expect-error TS2362
			void (slVersion / 2)
			// @ts-expect-error TS2362
			void (slVersion % 2)
			// @ts-expect-error TS2362
			void (slVersion & 1)
			// @ts-expect-error TS2362
			void (slVersion | 1)
			// @ts-expect-error TS2362
			void (slVersion ^ 1)
			// @ts-expect-error TS2362
			void (slVersion << 1)
			// @ts-expect-error TS2362
			void (slVersion >> 1)
		})
		test("one specification's revision where the other's is expected", () => {
			// @ts-expect-error TS2322
			const sl: A177Revision = cgVersion
			// @ts-expect-error TS2322
			const n: number = slVersion
			void [sl, n]
		})
		test("the TV-Anytime revision of an A177 revision is compared with TV-Anytime revisions", () => {
			// @ts-expect-error TS2365: tvAnytime is a TV-Anytime revision
			void (slVersion.tvAnytime < slVersions.r8)
			void (slVersion.tvAnytime < cgVersions.r3) // compiles
		})
		test("making a revision", () => {
			// @ts-expect-error TS2673: only the class makes its revisions, from r0 up to its latest
			void new A177Revision(9)
			// @ts-expect-error TS2673
			void new TVARevision(4)
		})
	})
})

// the revision in the name of each test document (NNNNrK ...) is the one its namespaces give, so that the tests of each
// revision are known from their names. A document of one revision named as another would test the wrong revision, and
// leave its own untested
describe("The revision of each test document", () => {
	// the servicediscovery-types namespace that the service list and registry schemas of each revision import (none before r6)
	const TYPES: Record<number, string> = { 6: "2023", 7: "2025", 8: "2026" }
	// documents that do not match on purpose, and why
	const EXCEPTIONS: Record<string, string> = {
		"0001r8 not bsContents namespace.xml": "tests a namespace that is not known (CG004)",
		"0013r7 invalid StandardVersion.xml": "tests a StandardVersion that is not valid",
		"0013r8 invalid StandardVersion.xml": "tests a StandardVersion that is not valid",
		"0001r6 tc-62-DE.xml": "a document of the BMT Germany testbed, kept as it is: it declares older namespaces that it does not use",
	}
	const documents: { path: string; revision: A177Revision }[] = []
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name)
			if (entry.isDirectory()) {
				if (!["node_modules", ".git"].includes(entry.name)) walk(path)
			} else if (entry.name.endsWith(".xml")) {
				const m = /^\d{3,4}r(\d)\b/.exec(entry.name)
				if (m) documents.push({ path, revision: A177Revision.all[Number(m[1])] })
			}
		}
	}
	walk(import.meta.dirname)

	// the problems of one document: each namespace it declares, and the StandardVersion of a service list
	const problems = (text: string, revision: A177Revision): string[] => {
		const found: string[] = []
		const body = text.replace(/<!--[\s\S]*?-->/g, "")
		const root = /<([\w.-]+:)?([\w.-]+)[\s>]/.exec(body.replace(/<\?[\s\S]*?\?>/g, ""))
		for (const [, prefix, ns] of body.matchAll(/xmlns(?::([\w.-]+))?="([^"]*)"/g)) {
			const name = prefix ?? "(default)"
			const types = /^urn:dvb:metadata:servicediscovery-types:(\w+)$/.exec(ns)
			if (/^urn:dvb:metadata:servicediscovery:/.test(ns)) {
				if (SL_SchemaVersion(ns) != revision) found.push(`${name}=${ns} is ${inspect(SL_SchemaVersion(ns))}`)
			} else if (/^urn:dvb:metadata:servicelistdiscovery:/.test(ns)) {
				if (SLR_SchemaVersion(ns) != revision) found.push(`${name}=${ns} is ${inspect(SLR_SchemaVersion(ns))}`)
			} else if (types) {
				if (types[1] != TYPES[revision.level]) found.push(`${name}=${ns}: ${revision.label} imports ${TYPES[revision.level] ? `types ${TYPES[revision.level]}` : "no types namespace"}`)
			} else if (/^urn:tva:metadata:/.test(ns) || name == "tva") {
				if (CG_SchemaVersion(ns) != revision.tvAnytime) found.push(`${name}=${ns} is ${inspect(CG_SchemaVersion(ns))}, ${revision.label} uses ${inspect(revision.tvAnytime)}`)
			}
		}
		// the StandardVersion of a service list is its own (in a registry response, it is that of an offered service list)
		if (root?.[2] == dvbi.e_ServiceList) {
			const version = /standardversion:(\d+)/.exec(body)
			if (version && Number(version[1]) != revision.level) found.push(`StandardVersion ${version[1]}`)
		}
		return found
	}

	test("the documents are found", () => assert.ok(documents.length > 400, String(documents.length)))
	test("their namespaces are those of the revision in their names", () => {
		const wrong = documents
			.filter((d) => !EXCEPTIONS[basename(d.path)])
			.map((d) => ({ path: relative(import.meta.dirname, d.path), found: problems(readFileSync(d.path, "utf8"), d.revision) }))
			.filter((d) => d.found.length > 0)
			.map((d) => `${d.path}: ${d.found.join("; ")}`)
		assert.deepEqual(wrong, [])
	})
	test("the exceptions are documents that do not match", () => {
		for (const name of Object.keys(EXCEPTIONS)) {
			const matching = documents.filter((d) => basename(d.path) == name)
			assert.ok(matching.length > 0, `${name} is not in the testsuite`)
			for (const d of matching) assert.ok(problems(readFileSync(d.path, "utf8"), d.revision).length > 0, `${name} matches its name: it is no longer an exception`)
		}
	})
	test("a document named for another revision is found", () => {
		const r8 = '<ServiceList xmlns="urn:dvb:metadata:servicediscovery:2026" xmlns:tva="urn:tva:metadata:2027"><StandardVersion>urn:dvb:metadata:dvbi:standardversion:8</StandardVersion></ServiceList>'
		assert.deepEqual(problems(r8, A177Revision.r8), [])
		assert.equal(problems(r8, A177Revision.r6).length, 3, "the namespace, the TV-Anytime namespace and the StandardVersion")
		assert.deepEqual(problems('<ServiceList xmlns="urn:dvb:metadata:servicediscovery:2024" xmlns:dt="urn:dvb:metadata:servicediscovery-types:2024"/>', A177Revision.r6), [
			"dt=urn:dvb:metadata:servicediscovery-types:2024: A177r6 imports types 2023",
		])
		assert.equal(problems('<TVAMain xmlns="urn:tva:metadata:2023"/>', A177Revision.r6).length, 1, "a content guide of TV-Anytime 2023 named r6")
		assert.deepEqual(problems('<TVAMain xmlns="urn:tva:metadata:2024"/>', A177Revision.r7), [], "TV-Anytime 2024 is used by r6 and r7")
	})
})
