// tests of the validator's web application (dvb-i-tools #89): loadConfig() reports a bad option by throwing a
// ConfigError, and createApp() is exercised in-process on an ephemeral port, without the listeners, cluster workers or
// process.exit() of the validator
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { loadConfig, ConfigError } from "../lib/config.mts"
import { createServices } from "../lib/services.mts"
import { createApp } from "../lib/app.mts"
import { Default_SLEPR } from "../lib/data_locations.mts"
import { configureFetchPolicy } from "../lib/safe_fetch.mts"

// the command line options as all-in-one.ts gives them by default
const defaults = {
	nosl: false, nopl: false, nocg: false, noslr: false, nocsr: false,
	CSRfile: Default_SLEPR.file, urls: false, SLRmode: "default",
	workers: 0, port: 0, sport: 0, allow_traversal: false, spam_blocker: false,
}

describe("Web application", () => {

	describe("loadConfig", () => {
		const rejects = (options: Record<string, unknown>, message: RegExp) =>
			assert.throws(() => loadConfig({ ...defaults, ...options }), (e: unknown) => e instanceof ConfigError && message.test((e as Error).message))

		test("nothing enabled", () => rejects({ nosl: true, nopl: true, nocg: true, noslr: true, nocsr: true }, /nothing to do/))
		test("invalid CORS mode", () => rejects({ CORSmode: "sideways" }, /CORSmode must be/))
		test("invalid fetch_concurrency", () => rejects({ fetch_concurrency: NaN }, /fetch_concurrency must be a positive whole number/))
		test("invalid fetch_per_host", () => rejects({ fetch_per_host: NaN }, /fetch_per_host must be a positive whole number/))
		test("no SLEPR file", () => {
			const withoutCSR: Record<string, unknown> = { ...defaults }
			delete withoutCSR.CSRfile
			assert.throws(() => loadConfig(withoutCSR), /SLEPR file not specified/)
		})
		test("defaults", () => {
			const config = loadConfig({ ...defaults })
			assert.equal(config.corsMode, "library")
			assert.ok(Object.isFrozen(config) && Object.isFrozen(config.features))
		})
		test("the master SLEPR is fetched with --urls", () => assert.equal(loadConfig({ ...defaults, urls: true }).csrFile, Default_SLEPR.url))
	})

	describe("createApp", () => {
		// the service list endpoints and the registry only
		const options = { ...defaults, nopl: true, nocg: true, noslr: true }
		const services = createServices(loadConfig(options))
		const servers: Server[] = []
		const listen = async (corsMode?: string): Promise<string> => {
			const server = createServer(createApp(loadConfig(corsMode ? { ...options, CORSmode: corsMode } : options), services, "test secret"))
			servers.push(server)
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		}
		let base = ""
		before(async () => { base = await listen() })
		after(() => servers.forEach((s) => s.close()))
		const status = async (path: string, init?: RequestInit) => (await fetch(base + path, init)).status

		test("only the enabled features are built", () => assert.ok(services.slcheck && services.csr && !services.cgcheck && !services.plcheck && !services.slrcheck))
		test("the enabled routes respond", async () => {
			assert.equal(await status("/check"), 200)
			assert.equal(await status("/validate_sl_json?url=https://example.invalid/x"), 200)
			assert.equal(await status("/query"), 200)
			assert.equal(await status("/stats"), 200)
		})
		test("the routes of features not offered are not found", async () => {
			assert.equal(await status("/validate_cg_json"), 404)
			assert.equal(await status("/validate_pl"), 404)
		})
		test("a validation endpoint refuses other methods", async () => assert.equal(await status("/validate_sl", { method: "PUT" }), 405))
		test("an unknown path is not found, with any method", async () => {
			for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) assert.equal(await status("/no/such/page", { method }), 404, method)
		})
		test("an unhandled error is reported without details", async () => {
			const r = await fetch(base + "/validate_sl_json", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=zz" }, body: "--zz\r\nContent-Disposition: form-data; name=x\r\n\r\n" })
			assert.equal(r.status, 500)
			assert.equal(await r.text(), "internal error while processing the request")
		})
		test("CORS headers on every route in library mode", async () => assert.equal((await fetch(base + "/check")).headers.get("access-control-allow-origin"), "*"))
		test("CORS headers only for /query in manual mode", async () => {
			const manual = await listen("manual")
			assert.equal((await fetch(manual + "/query")).headers.get("access-control-allow-origin"), "*")
			assert.equal((await fetch(manual + "/check")).headers.get("access-control-allow-origin"), null)
		})
	})

	// the live view of /check (dvb-i-tools #104): with traversal, the form asks for the progress of the validation as events
	// (application/x-ndjson), then the HTML of the results. The service list is the SAT-IP example with a content guide
	// source whose schedules come from a local server, which answers 404, so each traversed schedule has a VCG002 error
	describe("Live view of /check", () => {
		const options = { ...defaults, nopl: true, noslr: true, allow_traversal: true }
		const config = loadConfig(options)
		const services = createServices(config)
		const servers: Server[] = []
		let base = "", slURL = "", requests = 0, delay = 0
		const start = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> => {
			const server = createServer(handler)
			servers.push(server)
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		}
		before(async () => {
			configureFetchPolicy({ allowPrivateAddresses: true })
			const cg = await start(async (_req, res) => {
				requests++
				if (delay) await sleep(delay)
				res.statusCode = 404
				res.end()
			})
			const sl = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8").replace(
				'\t<Service version="1">',
				`\t<ContentGuideSource CGSID="cgs1"><ProviderName>Example</ProviderName><ScheduleInfoEndpoint contentType="application/xml"><URI>${cg}/schedule</URI></ScheduleInfoEndpoint></ContentGuideSource>\n\t<Service version="1">`
			)
			slURL = (await start((_req, res) => { res.setHeader("Content-Type", "application/xml"); res.end(sl) })) + "/sl.xml"
			base = await start(createApp(config, services, "test secret"))
		})
		after(() => {
			servers.forEach((s) => s.close())
			configureFetchPolicy({ allowPrivateAddresses: false })
		})
		const form = (fields: Record<string, string> = {}) => {
			const f = new FormData()
			for (const [k, v] of Object.entries({ testtype: "sl", doclocation: "url", XMLurl: slURL, traverse: "on", maxTraversal: "5", images: "no", ...fields })) f.append(k, v)
			return f
		}
		const LIVE = { Accept: "application/x-ndjson" }
		// the events, and the HTML after {"event":"results"}
		const read = (text: string) => {
			const marker = text.indexOf('{"event":"results"}\n')
			assert.ok(marker >= 0, "the results follow the events")
			const events = text.slice(0, marker).split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l))
			return { events, html: text.slice(marker + '{"event":"results"}\n'.length) }
		}

		test("the form has the live view only when traversal is allowed", async () => {
			assert.ok((await (await fetch(base + "/check")).text()).includes("application/x-ndjson"))
			const noTraversal = await start(createApp(loadConfig({ ...options, allow_traversal: false }), services, "test secret"))
			assert.ok(!(await (await fetch(noTraversal + "/check")).text()).includes("application/x-ndjson"))
		})
		test("events: the document's results, then the traversed documents", async () => {
			const r = await fetch(base + "/check", { method: "POST", body: form(), headers: LIVE })
			assert.equal(r.status, 200)
			assert.match(r.headers.get("content-type") ?? "", /^application\/x-ndjson/)
			assert.equal(r.headers.get("x-accel-buffering"), "no")
			const { events, html } = read(await r.text())
			assert.equal(events[0].event, "root")
			assert.ok(events[0].html.includes('class="badges"') && !events[0].html.includes('class="listing"'), "the document's own results, without its listing")
			const documents = new Map<number, { parent: number; state: string; codes?: Record<string, Record<string, number>> }>()
			for (const e of events.slice(1)) {
				assert.equal(e.event, "progress")
				for (const d of e.documents) {
					assert.ok(d.parent == 0 || documents.has(d.parent), "a document is listed after the document that referenced it")
					documents.set(d.id, d)
				}
			}
			const done = [...documents.values()]
			assert.equal(done.length, 5)
			for (const d of done) assert.deepEqual([d.state, d.codes?.errors], ["done", { VCG002: 1 }])
			const counts = events.at(-1).counts
			assert.equal(counts.validated, 5)
			assert.equal(counts.waiting, 0)
			assert.equal(counts.requested, counts.validated + counts.skipped)
			// the final results: the results part of the page, with the traversed documents table
			assert.ok(html.includes('id="trav"') && html.includes('class="listing"') && !html.includes("<footer>"))
			assert.equal((html.match(/<tr class="s-[a-z]+ d1"/g) ?? []).length, counts.requested)
		})
		test("the page without the live view is unchanged", async () => {
			const page = await (await fetch(base + "/check", { method: "POST", body: form() })).text()
			assert.ok(page.startsWith("<!DOCTYPE html>") && page.includes('<div id="results">') && page.includes('id="trav"'))
			assert.equal((page.match(/<footer>/g) ?? []).length, 1)
		})
		test("a form that is not valid gives only the results", async () => {
			const text = await (await fetch(base + "/check", { method: "POST", body: form({ maxTraversal: "lots" }), headers: LIVE })).text()
			const { events, html } = read(text)
			assert.deepEqual(events, [])
			assert.ok(html.includes("the maximum number of documents to traverse must be a positive whole number"))
		})
		for (const live of [true, false])
			test(`the validation stops when the client goes away (${live ? "live view" : "page"})`, async () => {
				requests = 0
				delay = 50
				const abort = new AbortController()
				const response = fetch(base + "/check", { method: "POST", body: form({ maxTraversal: "unlimited" }), headers: live ? LIVE : {}, signal: abort.signal })
					.then((r) => r.body?.getReader().read())
					.catch(() => undefined)
				while (requests < 20) await sleep(20)
				abort.abort()
				await response
				const atAbort = requests
				await sleep(1500)
				delay = 0
				// only the retrievals already started (at most --fetch_concurrency of them) are completed
				assert.ok(requests - atAbort <= 8, `${requests - atAbort} requests after the client went away`)
			})
	})
})
