/**
 * test-revisions.ts
 *
 *  DVB-I-tools
 *  Copyright (c) 2021-2026, Paul Higgs
 *  BSD-2-Clause license, see LICENSE.txt file
 *
 * The revisions of A177 and of TV-Anytime (dvb-i-tools #125): the operators within a specification, the methods, and the uses
 * that must not compile. Those are marked // @ts-expect-error, so `npm run typecheck` fails if one of them ever compiles
 */
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { inspect } from "node:util"

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

	describe("The methods", () => {
		test("known", () => {
			assert.ok(A177Revision.all.every((r) => r.known) && TVARevision.all.every((r) => r.known))
			assert.equal(slVersions.unknown.known, false)
			assert.equal(cgVersions.unknown.known, false)
		})
		test("plus(n) is the revision n later", () => {
			assert.equal(slVersions.r6.plus(1), slVersions.r7)
			assert.equal(slVersions.r6.plus(0), slVersions.r6)
			assert.equal(slVersions.r6.plus(-6), slVersions.r0)
			assert.equal(cgVersions.r0.plus(3), cgVersions.r3)
		})
		test("plus(n) past the latest or before r0 is unknown", () => {
			assert.equal(slVersions.r8.plus(1), slVersions.unknown)
			assert.equal(cgVersions.r3.plus(1), cgVersions.unknown)
			assert.equal(slVersions.r0.plus(-1), slVersions.unknown)
			assert.equal(slVersions.r6.plus(0.5), slVersions.unknown)
			assert.equal(slVersions.unknown.plus(1), slVersions.unknown)
		})
		test("minus(n) is the revision n earlier", () => {
			assert.equal(slVersions.r7.minus(1), slVersions.r6)
			assert.equal(cgVersions.r3.minus(3), cgVersions.r0)
			assert.equal(cgVersions.r0.minus(1), cgVersions.unknown)
		})
		test("minus(revision) is how many revisions apart", () => {
			assert.equal(slVersions.r8.minus(slVersions.r6), 2)
			assert.equal(slVersions.r6.minus(slVersions.r8), -2)
			assert.equal(cgVersions.r2.minus(cgVersions.r2), 0)
			assert.ok(Number.isNaN(slVersions.r6.minus(slVersions.unknown)))
		})
	})

	describe("The schema versions of documents", () => {
		test("a service list, registry and content guide namespace give their revisions", () => {
			assert.equal(SL_SchemaVersion(dvbi.A177r8_Namespace), slVersions.r8)
			assert.equal(SL_SchemaVersion(dvbi.A177r6_Namespace), slVersions.r6)
			assert.equal(SLR_SchemaVersion(dvbisld.A177r8_Namespace), slVersions.r8)
			assert.equal(CG_SchemaVersion(TVAschema.v2026.namespace), cgVersions.r3)
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
			// @ts-expect-error TS2365: use plus(n)
			void (slVersion + 1)
			// @ts-expect-error TS2362: use minus(n) or minus(revision)
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
		test("the methods only take a revision of the same specification", () => {
			// @ts-expect-error TS2769: how far apart revisions of different specifications are has no meaning
			void slVersion.minus(cgVersion)
			// @ts-expect-error TS2345
			void cgVersion.plus(slVersion)
		})
		test("one specification's revision where the other's is expected", () => {
			// @ts-expect-error TS2322
			const sl: A177Revision = cgVersion
			// @ts-expect-error TS2322
			const n: number = slVersion
			void [sl, n]
		})
		test("making a revision", () => {
			// @ts-expect-error TS2673: only the class makes its revisions, from r0 up to its latest
			void new A177Revision(9)
			// @ts-expect-error TS2673
			void new TVARevision(4)
		})
	})
})
