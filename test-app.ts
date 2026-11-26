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
import { configureFetchPolicy, stopAllValidations } from "../lib/safe_fetch.mts"
import { html, join as joinHTML, raw, text } from "../lib/html.mts"
import { PAGE_ASSETS } from "../lib/ui.mts"
import { Script, runInNewContext } from "node:vm"
import { setFlagsFromString } from "node:v8"
import ErrorList, { DEBUG, INFORMATION, WARNING } from "../lib/error_list.mts"
import { ScheduleCoverage } from "../lib/schedule_coverage.mts"
import { jsonResult } from "../lib/json_results.mts"
import { GERMAN_A177r6_VARIANT } from "../lib/globals.mts"

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
			const server = createServer(createApp(loadConfig(corsMode ? { ...options, CORSmode: corsMode } : options), services))
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
		// a form that ends too soon makes the form parser fail. The error and its stack are logged on the server (captured here,
		// so that the test output does not show them), and the client is not told the details
		test("an unhandled error is reported without details", async () => {
			const logged: string[] = []
			const log = console.log
			console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")) }
			let r: Response
			try {
				r = await fetch(base + "/check", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=zz" }, body: "--zz\r\nContent-Disposition: form-data; name=x\r\n\r\n" })
			} finally {
				console.log = log
			}
			assert.equal(r.status, 500)
			assert.equal(await r.text(), "internal error while processing the request")
			assert.ok(logged.some((l) => l.includes("unhandled error for POST /check: Error: Unexpected end of form")), "the error is logged")
		})
		test("CORS headers on every route in library mode", async () => assert.equal((await fetch(base + "/check")).headers.get("access-control-allow-origin"), "*"))
		test("CORS headers only for /query in manual mode", async () => {
			const manual = await listen("manual")
			assert.equal((await fetch(manual + "/query")).headers.get("access-control-allow-origin"), "*")
			assert.equal((await fetch(manual + "/check")).headers.get("access-control-allow-origin"), null)
		})

		// the form middleware, sessions and security headers (dvb-i-tools #89, items 7 and 8)
		test("no session cookie is set", async () => {
			for (const path of ["/check", "/validate_sl_json?url=https://example.invalid/x", "/query"]) assert.equal((await fetch(base + path)).headers.get("set-cookie"), null, path)
		})
		test("the standard security headers", async () => {
			const headers = (await fetch(base + "/check")).headers
			assert.equal(headers.get("x-content-type-options"), "nosniff")
			assert.equal(headers.get("x-frame-options"), "SAMEORIGIN")
			assert.equal(headers.get("cross-origin-resource-policy"), "cross-origin")
			assert.equal(headers.get("x-powered-by"), null)
			assert.equal(headers.get("strict-transport-security"), null)
			assert.ok(headers.get("content-security-policy"), "a content security policy")
		})
		test("the form shows the values submitted, and a new form the defaults", async () => {
			const url = "https://example.invalid/sl.xml?a=1&b=2"
			const body = new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: url, images: "no", signatureChecks: "none" })
			const submitted = await (await fetch(base + "/check", { method: "POST", body })).text()
			assert.ok(submitted.includes(`value="https://example.invalid/sl.xml?a=1&amp;b=2"`), "the URL")
			assert.ok(submitted.includes(`name="images" value="no" id="imgNo" checked`), "the image checking")
			assert.ok(submitted.includes(`name="signatureChecks" value="none" id="sigNone" checked`), "the signature checks")
			const fresh = await (await fetch(base + "/check")).text()
			assert.ok(fresh.includes(`placeholder="https://example.com/servicelist.xml" value=""`), "no URL")
			assert.ok(fresh.includes(`name="images" value="yes" id="imgYes" checked`), "the default image checking")
		})
		test("an uploaded document has the same size limit as a document sent to /validate_*", async () => {
			const form = (size: number) => {
				const body = new FormData()
				body.set("testtype", "sl")
				body.set("doclocation", "file")
				body.set("XMLfile", new Blob([" ".repeat(size)], { type: "application/xml" }), "sl.xml")
				return body
			}
			assert.equal((await fetch(base + "/check", { method: "POST", body: form(10 * 1024 * 1024 + 1) })).status, 413)
			assert.equal((await fetch(base + "/check", { method: "POST", body: form(1000) })).status, 200)
		})
		// the health endpoint (dvb-i-tools #89 item 11)
		test("the health endpoint", async () => {
			const health = async (app: ReturnType<typeof createApp>) => {
				const server = createServer(app)
				servers.push(server)
				await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
				const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`)
				return [r.status, await r.text(), r.headers.get("cache-control")]
			}
			const config = loadConfig(options)
			const app = createApp(config, services)
			assert.deepEqual(await health(app), [200, "ok", "no-store"])
			app.locals.stopping = true
			assert.deepEqual(await health(app), [503, "stopping", "no-store"])
			// the service list registry has not been read yet
			const starting = createApp(config, { ...services, csr: { loaded: false } as unknown as typeof services.csr })
			assert.deepEqual(await health(starting), [503, "starting", "no-store"])
		})
		test("the form fields are only read by /check", async () => {
			// a form posted to a validation endpoint is not parsed, so it is answered as a POST without a document
			const result = async (body?: URLSearchParams) => (await fetch(base + "/validate_sl_json", { method: "POST", body })).text()
			assert.equal(await result(new URLSearchParams({ url: "https://example.invalid/x" })), await result())
		})
	})

	// the service list registry returns its response, and the route sends it (dvb-i-tools #89, item 4). The registry is a
	// test document whose ServiceListURIs are each for A177r6 or r7, so a request from an r8 client is answered according
	// to its User-Agent
	describe("Service list registry responses", () => {
		const options = { ...defaults, nopl: true, nocg: true, noslr: true, nosl: true, CSRfile: join(import.meta.dirname, "test-005", "0001r8 - Simple Signature.xml") }
		const config = loadConfig(options)
		const services = createServices(config)
		const csr = services.csr!
		const r8 = "DVB-I/A177r8 (;Vendor;Model;1.0;1.0;TV;)"
		let server: Server, base = ""
		before(async () => {
			// the master registry document is held by the module, and is read asynchronously: it is read again here, after the
			// registries of the other tests have been read
			csr.loadServiceListRegistry(options.CSRfile)
			for (let i = 0; i < 100 && !csr.processServiceListRequest({}, undefined).body.includes("standardversion:7"); i++) await sleep(20)
			server = createServer(createApp(config, services))
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		})
		after(() => {
			server.close()
			csr.loadServiceListRegistry(Default_SLEPR.file)
		})

		test("a query is answered with the registry", () => {
			const response = csr.processServiceListRequest({}, undefined)
			assert.equal(response.status, 200)
			assert.equal(response.contentType, "application/xml")
			assert.deepEqual(response.vary, [])
			assert.ok(response.body.includes("standardversion:6") && response.body.includes("standardversion:7"))
		})
		test("the response depends on the A177 version in the User-Agent", async () => {
			const response = csr.processServiceListRequest({}, r8)
			assert.deepEqual(response.vary, ["User-Agent"])
			assert.ok(!response.body.includes("ServiceListOffering"), "no service list is for A177r8")
			const r = await fetch(base + "/query", { headers: { "User-Agent": r8 } })
			assert.equal(r.status, 200)
			assert.ok(r.headers.get("vary")?.includes("User-Agent"))
		})
		test("a query that is not valid is answered with its errors", async () => {
			const response = csr.processServiceListRequest({ nonsense: "1", regulatorListFlag: "maybe" }, undefined)
			assert.equal(response.status, 400)
			assert.deepEqual(response.parseErr, ["invalid argument - nonsense", "invalid regulatorListFlag [maybe]"])
			const r = await fetch(base + "/query?TargetCountry=XXX")
			assert.equal(r.status, 400)
			assert.equal(r.headers.get("x-content-type-options"), "nosniff")
			assert.equal(await r.text(), "[invalid TargetCountry [XXX]]")
		})
		test("the query capabilities", () => {
			const response = csr.processServiceListRequest({ queryCapabilities: "" }, undefined)
			assert.equal(response.status, 200)
			assert.equal(response.contentType, "text/plain")
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
			base = await start(createApp(config, services))
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

		// the live view is in the page script, which the form turns on with data-live (dvb-i-tools #89)
		test("the form has the live view only when traversal is allowed", async () => {
			const formTag = async (server: string) => (await (await fetch(server + "/check")).text()).match(/<form [^>]*id="check-form"[^>]*>/)?.[0] ?? ""
			assert.ok((await formTag(base)).includes(" data-live"))
			const noTraversal = await start(createApp(loadConfig({ ...options, allow_traversal: false }), services))
			assert.ok(!(await formTag(noTraversal)).includes("data-live"))
			assert.ok((await (await fetch(base + PAGE_ASSETS[1].path)).text()).includes("application/x-ndjson"))
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

		// a shutdown (SIGTERM, dvb-i-tools #89 item 11) stops the validations in progress, which finish with the results so far
		test("a shutdown stops the validations in progress", async () => {
			requests = 0
			delay = 50
			const response = fetch(base + "/check", { method: "POST", body: form({ maxTraversal: "unlimited" }) }).then((r) => r.text())
			while (requests < 20) await sleep(20)
			assert.equal(stopAllValidations(), 1)
			const atStop = requests
			const page = await response
			delay = 0
			assert.ok(requests - atStop <= 8, `${requests - atStop} requests after the validation was stopped`)
			assert.ok(page.includes('id="trav"') && page.includes("<footer>"), "the results so far are sent")
		})
	})
	// the html`` template (dvb-i-tools #89 item 9): what is interpolated is escaped unless it is already HTML
	describe("HTML template", () => {
		test("values are escaped", () => assert.equal(String(html`<td title="${'a"b'}">${"<script>&"}</td>`), '<td title="a&quot;b">&lt;script&gt;&amp;</td>'))
		test("HTML is not escaped again", () => assert.equal(String(html`<tr>${html`<td>${"<"}</td>`}</tr>`), "<tr><td>&lt;</td></tr>"))
		test("arrays are joined, and undefined, null and false give nothing", () => {
			assert.equal(String(html`${["<a>", html`<b/>`]}|${undefined}|${null}|${false}|${0}|${true}`), "&lt;a&gt;<b/>||||0|true")
		})
		test("text() makes hyphens non-breaking", () => assert.equal(String(text("SL-005 a=b <x>")), "SL&#8209;005 a&#x3D;b &lt;x&gt;"))
		test("raw() and join()", () => assert.equal(String(joinHTML(["<", raw("<i>x</i>")], raw("<br/>"))), "&lt;<br/><i>x</i>"))
		test("a value from a request is escaped on the page", async () => {
			const services = createServices(loadConfig({ ...defaults, nopl: true, nocg: true, noslr: true }))
			const server = createServer(createApp(loadConfig({ ...defaults, nopl: true, nocg: true, noslr: true }), services))
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			try {
				const url = 'https://example.invalid/"><script>alert(1)</script>'
				const body = new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: url, images: "no" })
				const page = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/check`, { method: "POST", body })).text()
				assert.ok(!page.includes("<script>alert(1)"), "the URL is not written as markup")
				assert.ok(page.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"), "the URL is shown escaped")
			} finally {
				server.close()
			}
		})
	})
	// the content security policy (dvb-i-tools #89): the pages load their stylesheet and script from the validator, and have
	// no inline scripts, styles or event handlers
	describe("Content security policy", () => {
		const POLICY = "default-src 'none';script-src 'self';style-src 'self';img-src 'self';connect-src 'self';form-action 'self';frame-ancestors 'self';base-uri 'none'"
		const options = { ...defaults, nopl: true, noslr: true, allow_traversal: true }
		const services = createServices(loadConfig(options))
		let server: Server, base = ""
		before(async () => {
			server = createServer(createApp(loadConfig(options), services))
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		})
		after(() => server.close())
		const [STYLESHEET, SCRIPT] = PAGE_ASSETS
		const PAGES = ["/check", "/stats", "/langs", "/validate_sl?url=https://example.invalid/sl.xml", "/validate_cg?url=https://example.invalid/cg.xml&type=Time"]
		// markup that the policy would refuse: a script or style in the page, a style attribute, an event handler, a javascript: URL
		const INLINE = [/<script(?![^>]*\ssrc=)[^>]*>/i, /<style[\s>]/i, /\sstyle=/i, /\son[a-z]+=/i, /javascript:/i]
		const page = async (path: string, init?: RequestInit) => (await fetch(base + path, init)).text()

		test("every response has the policy", async () => {
			for (const path of [...PAGES, "/validate_sl_json?url=https://example.invalid/x", "/query", "/healthz", "/no-such-page", STYLESHEET.path])
				assert.equal((await fetch(base + path)).headers.get("content-security-policy"), POLICY, path)
		})
		test("the policy does not upgrade requests to HTTPS", async () => {
			assert.ok(!(await fetch(base + "/check")).headers.get("content-security-policy")!.includes("upgrade-insecure-requests"))
		})
		test("the pages have no inline scripts, styles or event handlers", async () => {
			for (const path of PAGES) {
				const text = await page(path)
				for (const pattern of INLINE) assert.doesNotMatch(text, pattern, `${path}: ${pattern}`)
			}
		})
		test("the results of a /check validation have no inline scripts, styles or event handlers", async () => {
			const body = new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: "https://example.invalid/sl.xml", images: "no" })
			const text = await page("/check", { method: "POST", body })
			assert.ok(text.includes('id="results"'))
			for (const pattern of INLINE) assert.doesNotMatch(text, pattern, String(pattern))
		})
		test("each page loads the stylesheet and the script once", async () => {
			for (const path of PAGES) {
				const text = await page(path)
				assert.equal(text.split(`<link rel="stylesheet" href="${STYLESHEET.href}">`).length, 2, `${path}: the stylesheet`)
				assert.equal(text.split(`<script src="${SCRIPT.href}"`).length, 2, `${path}: the script`)
			}
		})
		test("the /check page loads the script after the form, and the other pages from the head", async () => {
			assert.ok((await page("/check")).includes(`</form><script src="${SCRIPT.href}"></script>`))
			assert.ok((await page("/stats")).includes(`<script src="${SCRIPT.href}" defer></script></head>`))
		})
		test("the stylesheet and script are served, and can be cached", async () => {
			for (const [asset, type] of [[STYLESHEET, "text/css; charset=utf-8"], [SCRIPT, "text/javascript; charset=utf-8"]] as const) {
				const r = await fetch(base + asset.href)
				assert.equal(r.status, 200)
				assert.equal(r.headers.get("content-type"), type)
				assert.equal(r.headers.get("cache-control"), "public, max-age=31536000, immutable")
				assert.equal(await r.text(), asset.body)
			}
		})
		test("the address of each file has a hash of its content", () => {
			assert.match(STYLESHEET.href, /^\/ui\/validator\.css\?v=[0-9a-f]{12}$/)
			assert.match(SCRIPT.href, /^\/ui\/validator\.js\?v=[0-9a-f]{12}$/)
			assert.notEqual(STYLESHEET.href.split("?v=")[1], SCRIPT.href.split("?v=")[1])
		})
		test("the script is valid JavaScript", () => assert.doesNotThrow(() => new Script(SCRIPT.body)))
		test("the stylesheet has no imports or external resources", () => assert.doesNotMatch(STYLESHEET.body, /@import|url\(/))
		test("other files are not served", async () => {
			assert.equal((await fetch(base + "/ui/other.js")).status, 404)
			assert.equal((await fetch(base + "/ui/")).status, 404)
			assert.equal((await fetch(base + "/ui/%2e%2e/package.json")).status, 404)
			assert.equal((await fetch(base + SCRIPT.path, { method: "POST" })).status, 404)
		})
		test("the traversed documents filter is hidden until the script shows it", () => {
			assert.match(SCRIPT.body, /\.filters\[hidden\]/)
			assert.match(SCRIPT.body, /closest\("\.filters button"\)/)
		})
	})
	// what a validation keeps once it has finished (dvb-i-tools #99). The results of every traversed document are kept by the
	// caller's ErrorList, so they must be released when the caller lets go of it. Before, a keep-alive connection (or the DNS
	// resolver) opened during the validation kept its scope, and through it all of its results, for as long as it lasted
	describe("Memory after a validation", () => {
		setFlagsFromString("--expose-gc")
		const gc = runInNewContext("gc") as () => void
		const collect = async () => {
			for (let i = 0; i < 3; i++) {
				await sleep(10)
				gc()
			}
		}
		const services = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, allow_traversal: true }))
		let cgServer: Server, slText = ""
		before(async () => {
			configureFetchPolicy({ allowPrivateAddresses: true })
			// a content guide source whose schedules are not found (VCG002), on a server that keeps its connections open
			cgServer = createServer((_req, res) => {
				res.statusCode = 404
				res.end()
			})
			cgServer.keepAliveTimeout = 60000
			await new Promise<void>((resolve) => cgServer.listen(0, "127.0.0.1", resolve))
			const cg = `http://127.0.0.1:${(cgServer.address() as AddressInfo).port}`
			slText = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8").replace(
				'\t<Service version="1">',
				`\t<ContentGuideSource CGSID="cgs1"><ProviderName>Example</ProviderName><ScheduleInfoEndpoint contentType="application/xml"><URI>${cg}/schedule</URI></ScheduleInfoEndpoint></ContentGuideSource>\n\t<Service version="1">`
			)
		})
		after(() => {
			cgServer.closeAllConnections()
			cgServer.close()
			configureFetchPolicy({ allowPrivateAddresses: false })
		})
		// validate with traversal, and return weak references to the results and to the first traversed document's results
		const validate = async (maxTraversal: number) => {
			const errs = ErrorList.withMarkup()
			await services.slcheck!.doValidateServiceList(slText, errs, { traverse: true, maxTraversal, images: "no" })
			const traversed = errs.nestedErrors.filter((e) => e.codesReported("errors").some(([code]) => code == "VCG002")).length
			return { results: new WeakRef(errs), nested: new WeakRef(errs.nestedErrors[0]), lists: errs.nestedErrors.length, traversed }
		}
		const openConnections = () => new Promise<number>((resolve) => cgServer.getConnections((_e, n) => resolve(n)))

		test("the results of the traversed documents are released with the results", async () => {
			const { results, nested, lists, traversed } = await validate(5)
			assert.equal(traversed, 5, "5 schedules are traversed")
			assert.ok(lists > traversed, "the skipped documents also have results")
			assert.ok((await openConnections()) > 0, "a connection made during the validation is still open")
			await collect()
			assert.equal(results.deref(), undefined, "the results are released")
			assert.equal(nested.deref(), undefined, "the results of a traversed document are released")
		})
		test("with one document traversed, over a connection opened by an earlier validation", async () => {
			const { nested, traversed } = await validate(1)
			assert.equal(traversed, 1)
			await collect()
			assert.equal(nested.deref(), undefined)
		})
		test("the results are kept while the caller has them", async () => {
			const errs = ErrorList.withMarkup()
			await services.slcheck!.doValidateServiceList(slText, errs, { traverse: true, maxTraversal: 5, images: "no" })
			const nested = new WeakRef(errs.nestedErrors[0])
			await collect()
			assert.ok(nested.deref() === errs.nestedErrors[0], "the results of a traversed document are still there")
			assert.ok(errs.timing && errs.timing.requests >= 5, "with the timing of the validation")
		})
		test("a validation started after one has finished traverses its own documents", async () => {
			const first = await validate(5)
			const second = await validate(5)
			assert.equal(second.traversed, first.traversed)
		})

		// a summary list (for a traversed document) shares one empty array for the findings it never keeps
		describe("Summary lists", () => {
			const SHARED = ["countsFatal", "countsErr", "countsWarn", "countsInfo", "fatals", "errors", "warnings", "informationals", "errorDescriptions"] as const
			test("share the arrays they do not use", () => {
				const a = ErrorList.summaryOnly("https://example.invalid/a", "Time", "a"), b = ErrorList.summaryOnly("https://example.invalid/b", "Time", "b")
				for (const field of SHARED) {
					assert.equal(a[field], b[field], field)
					assert.ok(Object.isFrozen(a[field]) && a[field].length == 0, field)
				}
			})
			test("count the codes reported, and leave the shared arrays empty", () => {
				const a = ErrorList.summaryOnly("https://example.invalid/a", "Time", "a")
				a.addError({ code: "VCG002", message: "not found" })
				a.addError({ code: "VCG002", message: "not found" })
				a.addError({ type: WARNING, code: "CG021", message: "w", key: "k", description: "d" })
				assert.deepEqual(a.codesReported("errors"), [["VCG002", 2]])
				assert.deepEqual(a.codesReported("warnings"), [["CG021", 1]])
				assert.equal(a.numErrors(), 2)
				for (const field of SHARED) assert.equal(a[field].length, 0, field)
			})
			// item 3 of dvb-i-tools #99: the debug messages, nested lists and code counts are also shared until the list has some
			const summary = (name: string) => ErrorList.summaryOnly(`https://example.invalid/${name}`, "Time", name)
			test("share their debug messages, nested lists and code counts while they have none", () => {
				const a = summary("a"), b = summary("b")
				assert.equal(a.debugs, b.debugs)
				assert.equal(a.nestedErrors, b.nestedErrors)
				assert.equal(a.codeCounts, b.codeCounts)
				assert.ok(Object.isFrozen(a.debugs) && Object.isFrozen(a.nestedErrors) && Object.isFrozen(a.codeCounts))
				assert.equal(a.numErrors() + a.numWarnings(), 0)
			})
			test("lists with one code, reported once, share its count", () => {
				// as every document skipped because a traversal limit was reached does
				const a = summary("a"), b = summary("b"), c = summary("c")
				for (const list of [a, b]) list.addError({ type: WARNING, code: "TRAV003", message: "limit reached", key: "traversal" })
				c.addError({ type: WARNING, code: "TRAV002", message: "depth reached", key: "traversal" })
				assert.equal(a.codeCounts, b.codeCounts)
				assert.notEqual(a.codeCounts, c.codeCounts)
				assert.deepEqual(a.codesReported("warnings"), [["TRAV003", 1]])
				assert.deepEqual(c.codesReported("warnings"), [["TRAV002", 1]])
			})
			test("a second report gives the list its own counts, and the others are not changed", () => {
				const a = summary("a"), b = summary("b")
				for (const list of [a, b]) list.addError({ code: "VCG002", message: "not found" })
				a.addError({ code: "VCG002", message: "not found" })
				b.addError({ type: WARNING, code: "CG021", message: "w" })
				assert.notEqual(a.codeCounts, b.codeCounts)
				assert.deepEqual(a.codesReported("errors"), [["VCG002", 2]])
				assert.deepEqual(a.codesReported("warnings"), [])
				assert.deepEqual(b.codesReported("errors"), [["VCG002", 1]])
				assert.deepEqual(b.codesReported("warnings"), [["CG021", 1]])
				assert.deepEqual(summary("c").codesReported("errors"), [])
				const d = summary("d")
				d.addError({ code: "VCG002", message: "not found" })
				assert.deepEqual(d.codesReported("errors"), [["VCG002", 1]], "the shared count of VCG002 is unchanged")
			})
			test("the first debug message or nested list gives the list its own", () => {
				const a = summary("a"), b = summary("b"), c = summary("c")
				a.addError({ type: DEBUG, code: "D1", message: "debug" })
				a.addNested(b)
				assert.equal(a.debugs.length, 1)
				assert.deepEqual(a.nestedErrors, [b])
				assert.ok(!Object.isFrozen(a.debugs) && !Object.isFrozen(a.nestedErrors))
				assert.equal(b.debugs.length + b.nestedErrors.length + c.debugs.length + c.nestedErrors.length, 0, "the other lists are not changed")
				a.addNested(c)
				assert.deepEqual(a.nestedErrors, [b, c])
			})
			test("are serialised as before", () => {
				const none = summary("none"), one = summary("one"), more = summary("more")
				one.addError({ code: "VCG002", message: "not found" })
				for (const code of ["VCG002", "VCG002"]) more.addError({ code, message: "not found" })
				more.addError({ type: INFORMATION, code: "I1", message: "i" })
				const json = (list: ErrorList) => JSON.parse(JSON.stringify(list))
				for (const field of [...SHARED, "debugs", "nestedErrors"]) assert.deepEqual(json(none)[field], [], field)
				assert.equal(JSON.stringify(json(none).codeCounts), JSON.stringify({ fatals: {}, errors: {}, warnings: {}, informationals: {} }))
				assert.equal(JSON.stringify(json(one).codeCounts), JSON.stringify({ fatals: {}, errors: { VCG002: 1 }, warnings: {}, informationals: {} }))
				assert.equal(JSON.stringify(json(more).codeCounts), JSON.stringify({ fatals: {}, errors: { VCG002: 2 }, warnings: {}, informationals: { I1: 1 } }))
			})
			test("a full list has its own arrays", () => {
				const a = new ErrorList(), b = ErrorList.withMarkup()
				for (const field of SHARED) {
					assert.notEqual(a[field], b[field], field)
					assert.ok(!Object.isFrozen(a[field]), field)
				}
			})
			test("adding to a shared array by mistake fails", () => {
				const a = ErrorList.summaryOnly("https://example.invalid/a", "Time", "a")
				assert.throws(() => a.errors.push({ code: "X", message: "y" } as never), TypeError)
				assert.throws(() => a.nestedErrors.push(summary("n")), TypeError)
				assert.throws(() => { a.codeCounts!.errors.X = 1 }, TypeError)
				assert.equal(ErrorList.summaryOnly("https://example.invalid/b", "Time", "b").errors.length, 0)
			})
		})
	})
	// the coverage of the schedule of each service (dvb-i-tools #122)
	describe("Schedule coverage", () => {
		const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
		const DAY0 = Date.UTC(2026, 10, 10)

		describe("The state of a day", () => {
			// a coverage of 3 days from DAY0 (one day either side of DAY0 + 1 day)
			const coverage = () => new ScheduleCoverage("sid", DAY0 + DAY, 1)
			const states = (c: ScheduleCoverage) => c.evaluate().days.map((d) => d.state)
			test("no events: none", () => assert.deepEqual(states(coverage()), ["none", "none", "none"]))
			test("an event that covers the whole period: full, with the minutes covered", () => {
				const c = coverage()
				c.addEvent(DAY0 - HOUR, DAY0 + 3 * DAY + HOUR)
				const result = c.evaluate()
				assert.deepEqual(result.days.map((d) => d.state), ["full", "full", "full"])
				assert.deepEqual(result.days.map((d) => d.coveredMinutes), [1440, 1440, 1440])
				assert.deepEqual(result.days.map((d) => d.date), ["2026-11-10", "2026-11-11", "2026-11-12"])
				assert.deepEqual(result.counts, { full: 3, partial: 0, none: 0, indeterminate: 0 })
			})
			test("an event over midnight covers both days", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + DAY + 12 * HOUR)
				c.addEvent(DAY0 + DAY + 12 * HOUR, DAY0 + 3 * DAY)
				assert.deepEqual(states(c), ["full", "full", "full"])
			})
			test("overlapping events are counted once", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + 20 * HOUR)
				c.addEvent(DAY0 + 10 * HOUR, DAY0 + DAY)
				assert.equal(c.evaluate().days[0].state, "full")
				assert.equal(c.evaluate().days[0].coveredMinutes, 1440)
			})
			test("a gap of the tolerance (5 minutes) is not counted", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + 12 * HOUR)
				c.addEvent(DAY0 + 12 * HOUR + 5 * MIN, DAY0 + DAY)
				assert.equal(c.evaluate().days[0].state, "full")
				assert.equal(c.evaluate().days[0].coveredMinutes, 1435)
			})
			test("a gap just longer than the tolerance is: partial", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + 12 * HOUR)
				c.addEvent(DAY0 + 12 * HOUR + 5 * MIN + 1000, DAY0 + DAY)
				assert.equal(c.evaluate().days[0].state, "partial")
			})
			test("a short gap at the start or end of the day is not counted", () => {
				const c = coverage()
				c.addEvent(DAY0 + 4 * MIN, DAY0 + DAY - 4 * MIN)
				assert.equal(c.evaluate().days[0].state, "full")
			})
			test("an event with no length, or ending before it starts, is left out", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0)
				c.addEvent(DAY0 + DAY, DAY0)
				c.addEvent(NaN, DAY0)
				assert.deepEqual(states(c), ["none", "none", "none"])
			})
			test("a skipped window with no gap in the others: indeterminate", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + 18 * HOUR)
				c.skipped(c.window(DAY0 + 18 * HOUR, DAY0 + DAY))
				assert.equal(c.evaluate().days[0].state, "indeterminate")
			})
			test("a skipped window and a gap in another window: partial", () => {
				const c = coverage()
				c.addEvent(DAY0, DAY0 + 4 * HOUR)
				c.skipped(c.window(DAY0 + 18 * HOUR, DAY0 + DAY))
				assert.equal(c.evaluate().days[0].state, "partial")
			})
			test("all of a day's windows skipped: indeterminate", () => {
				const c = coverage()
				for (let h = 0; h < 24; h += 6) c.skipped(c.window(DAY0 + h * HOUR, DAY0 + (h + 6) * HOUR))
				assert.equal(c.evaluate().days[0].state, "indeterminate")
			})
			test("a skipped window covered by events from the others: full", () => {
				const c = coverage()
				c.addEvent(DAY0 - HOUR, DAY0 + DAY + HOUR)
				c.skipped(c.window(DAY0 + 6 * HOUR, DAY0 + 12 * HOUR))
				assert.equal(c.evaluate().days[0].state, "full")
			})
			test("the days are those either side of today", () => {
				const result = new ScheduleCoverage("sid", DAY0, 28).evaluate()
				assert.equal(result.days.length, 57)
				assert.equal(result.days[28].date, "2026-11-10")
				assert.equal(result.daysEitherSide, 28)
			})
		})

		// a service list with one service, whose schedules come from a local server. The Germany option asks for 7 days either
		// side of today, in 60 windows of 6 hours. The schedule has a gap on some days (see timeline())
		describe("Traversal", () => {
			const services = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, allow_traversal: true }))
			const today = (() => {
				const d = Temporal.Now.plainDateISO()
				return Date.UTC(d.year, d.month - 1, d.day)
			})()
			const first = today - 7 * DAY
			// the events of the service: 2 hour events from 1:00, so that they cross the 6 hour windows (the event at 23:00 is in
			// two parts, so that no event crosses midnight and a day's events are only in its own windows), except
			//   day 3: none; day 5: none from 10:00 to 14:00; day 9: every request fails (404);
			//   day 10: a gap of 5 minutes (the tolerance); day 11: a gap of 6 minutes
			const timeline = (): [number, number][] => {
				const events: [number, number][] = []
				for (let t = first - DAY + HOUR; t < first + 16 * DAY; t += 2 * HOUR) {
					const hour = ((((t - first) % DAY) + DAY) % DAY) / HOUR, day = Math.floor((t - first) / DAY)
					const short = day == 10 && hour == 11 ? 5 * MIN : day == 11 && hour == 11 ? 6 * MIN : 0
					if (hour == 23) events.push([t, t + HOUR], [t + HOUR, t + 2 * HOUR])
					else events.push([t, t + 2 * HOUR - short])
				}
				const dayOf = (ms: number) => Math.floor((ms - first) / DAY), hourOf = (ms: number) => ((((ms - first) % DAY) + DAY) % DAY) / HOUR
				return events
					.filter(([s]) => dayOf(s) != 3 && !(dayOf(s) == 5 && [9, 11, 13].includes(hourOf(s))))
					// day 5: from 9:00 to 10:00, and 14:00 to 15:00, so that the gap is from 10:00 to 14:00
					.concat([[first + 5 * DAY + 9 * HOUR, first + 5 * DAY + 10 * HOUR], [first + 5 * DAY + 14 * HOUR, first + 5 * DAY + 15 * HOUR]])
			}
			const EVENTS = timeline()
			const iso = (ms: number) => new Date(ms).toISOString().replace(".000", "")
			const schedule = (start: number, end: number, events: [number, number][]) =>
				`<?xml version="1.0" encoding="UTF-8"?><TVAMain xmlns="urn:tva:metadata:2027" xml:lang="en"><ProgramDescription><ProgramInformationTable xml:lang="en"/>` +
				`<ProgramLocationTable xml:lang="en"><Schedule serviceIDRef="tag:example.com,2026:svc" start="${iso(start)}" end="${iso(end)}">` +
				events.map(([s, e]) => `<ScheduleEvent><Program crid="crid://example.com/p${s}"/><PublishedStartTime>${iso(s)}</PublishedStartTime><PublishedDuration>PT${(e - s) / 1000}S</PublishedDuration></ScheduleEvent>`).join("") +
				`</Schedule></ProgramLocationTable></ProgramDescription></TVAMain>`
			const servers: Server[] = []
			let slText = "", requested: string[] = [], honourInclusive = true
			before(async () => {
				configureFetchPolicy({ allowPrivateAddresses: true })
				const cg = createServer((req, res) => {
					const url = new URL(req.url ?? "", "http://localhost")
					requested.push(url.search)
					const start = Number(url.searchParams.get("start")) * 1000, end = Number(url.searchParams.get("end")) * 1000
					if (!url.searchParams.get("start") || Math.floor((start - first) / DAY) == 9) {
						res.statusCode = 404
						return res.end()
					}
					const inclusive = honourInclusive && url.searchParams.get("inclusive") == "true"
					const events = EVENTS.filter(([s, e]) => s < end && (inclusive ? e > start : s >= start))
					res.setHeader("Content-Type", "application/xml")
					res.end(schedule(inclusive ? Math.min(start, ...events.map(([s]) => s)) : start, end, events))
				})
				servers.push(cg)
				await new Promise<void>((resolve) => cg.listen(0, "127.0.0.1", resolve))
				slText = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8").replace(
					'\t<Service version="1">',
					`\t<ContentGuideSource CGSID="cgs1"><ProviderName>Example</ProviderName><ScheduleInfoEndpoint contentType="application/xml"><URI>http://127.0.0.1:${(cg.address() as AddressInfo).port}/schedule</URI></ScheduleInfoEndpoint></ContentGuideSource>\n\t<Service version="1">`
				)
			})
			after(() => {
				servers.forEach((s) => { s.closeAllConnections(); s.close() })
				configureFetchPolicy({ allowPrivateAddresses: false })
			})
			const validate = async (maxTraversal: number) => {
				const errs = ErrorList.withMarkup()
				requested = []
				await services.slcheck!.doValidateServiceList(slText, errs, { traverse: true, maxTraversal, images: "no", variants: GERMAN_A177r6_VARIANT })
				return errs
			}
			const stateOf = (errs: ErrorList) => errs.scheduleCoverage![0].days.map((d) => d.state)
			const EXPECTED = ["full", "full", "full", "none", "full", "partial", "full", "full", "full", "none", "full", "partial", "full", "full", "full"]

			test("the coverage of each day", async () => {
				const errs = await validate(Infinity)
				assert.equal(errs.scheduleCoverage?.length, 1)
				assert.deepEqual(stateOf(errs), EXPECTED)
				assert.deepEqual(errs.scheduleCoverage![0].counts, { full: 11, partial: 2, none: 2, indeterminate: 0 })
				assert.equal(errs.scheduleCoverage![0].days[5].coveredMinutes, 20 * 60)
				assert.equal(errs.scheduleCoverage![0].days[10].coveredMinutes, 1440 - 5)
			})
			test("a warning for the service, with the dates", async () => {
				const errs = await validate(Infinity)
				const warnings = errs.warnings.filter((w) => w.code == "SL201")
				assert.equal(warnings.length, 1)
				const day = (n: number) => new Date(first + n * DAY).toISOString().slice(0, 10)
				assert.match(warnings[0].message, /11 fully covered, 2 partly, 2 not at all\./)
				assert.ok(warnings[0].message.includes(`Not covered: ${day(3)}, ${day(9)}`), warnings[0].message)
				assert.ok(warnings[0].message.includes(`Partly covered: ${day(5)}, ${day(11)}`), warnings[0].message)
			})
			test("the schedules are requested with inclusive=true", async () => {
				await validate(Infinity)
				const windows = requested.filter((q) => q.includes("start="))
				assert.equal(windows.length, 60)
				assert.ok(windows.every((q) => q.endsWith("&inclusive=true")))
			})
			test("a server that ignores inclusive gives the same coverage", async () => {
				honourInclusive = false
				try {
					assert.deepEqual(stateOf(await validate(Infinity)), EXPECTED)
				} finally {
					honourInclusive = true
				}
			})
			test("days whose windows a traversal limit skipped are indeterminate", async () => {
				// the now/next request and 29 windows: days 0 to 6, and the first window of day 7
				const errs = await validate(30)
				const states = stateOf(errs)
				assert.deepEqual(states.slice(0, 7), EXPECTED.slice(0, 7))
				assert.ok(states.slice(7).every((s) => s == "indeterminate"), states.join())
				assert.deepEqual(errs.scheduleCoverage![0].counts, { full: 5, partial: 1, none: 1, indeterminate: 8 })
				assert.match(errs.warnings.find((w) => w.code == "SL201")!.message, /and 8 indeterminate because a traversal limit was reached/)
			})
			test("no warning when every day is covered or indeterminate", async () => {
				// days 0 to 2 are covered, and the rest skipped
				const errs = await validate(13)
				assert.ok(stateOf(errs).slice(0, 3).every((s) => s == "full"))
				assert.ok(stateOf(errs).slice(3).every((s) => s == "indeterminate"))
				assert.equal(errs.warnings.filter((w) => w.code == "SL201").length, 0)
			})
			test("two services with the same service ID share one schedule, reported once", async () => {
				// a second service, whose ContentGuideServiceRef is the service ID of the first
				const service = slText.slice(slText.indexOf('\t<Service version="1">'), slText.indexOf("</Service>") + "</Service>".length)
				const second = service
					.replace("<UniqueIdentifier>tag:daserste.de,2019:DasErste</UniqueIdentifier>", "<UniqueIdentifier>tag:daserste.de,2019:DasErsteHD</UniqueIdentifier>")
					.replace("</ServiceName>", "</ServiceName>\n\t\t<ContentGuideServiceRef>tag:daserste.de,2019:DasErste</ContentGuideServiceRef>")
				assert.ok(second.includes("DasErsteHD") && second.includes("<ContentGuideServiceRef>"))
				const errs = ErrorList.withMarkup()
				requested = []
				await services.slcheck!.doValidateServiceList(slText.replace(service, `${service}\n${second}`), errs, { traverse: true, maxTraversal: Infinity, images: "no", variants: GERMAN_A177r6_VARIANT })
				assert.equal(errs.scheduleCoverage?.length, 1)
				assert.deepEqual(errs.scheduleCoverage![0].services, ["tag:daserste.de,2019:DasErste", "tag:daserste.de,2019:DasErsteHD"])
				assert.deepEqual(stateOf(errs), EXPECTED)
				assert.equal(requested.filter((q) => q.includes("start=")).length, 60, "the windows are requested once")
				const warnings = errs.warnings.filter((w) => w.code == "SL201")
				assert.equal(warnings.length, 1)
				assert.ok(warnings[0].message.includes('of services "tag:daserste.de,2019:DasErste", "tag:daserste.de,2019:DasErsteHD"'), warnings[0].message)
			})
			test("the JSON summary and the HTML report", async () => {
				const errs = await validate(Infinity)
				const json = jsonResult(errs, "summary") as { scheduleCoverage: { service: string; counts: unknown }[] }
				assert.equal(json.scheduleCoverage.length, 1)
				assert.deepEqual(json.scheduleCoverage[0].counts, { full: 11, partial: 2, none: 2, indeterminate: 0 })
				// with a POST, the choices are in X- headers
				const headers = { "Content-Type": "application/xml", "X-traverse": "true", "X-max-traversal": "unlimited", "X-variants": "DE", "X-images": "no" }
				const page = await (await fetch(`${await listenApp()}/validate_sl`, { method: "POST", body: slText, headers })).text()
				assert.ok(page.includes('id="coverage"'), "the section")
				assert.equal(page.split('class="cov ').length - 1, 15 + 4, "a cell for each day, and the legend")
				assert.ok(page.includes('class="cov none"') && page.includes('class="cov partial"') && page.includes('class="cov full'))
			})
			// the validator's application, to check the HTML report
			const listenApp = async () => {
				const server = createServer(createApp(loadConfig({ ...defaults, nopl: true, noslr: true, allow_traversal: true }), services))
				servers.push(server)
				await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
				return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
			}
		})
	})
})
