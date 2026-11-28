// tests of the validator's web application (dvb-i-tools #89): loadConfig() reports a bad option by throwing a
// ConfigError, and createApp() is exercised in-process on an ephemeral port, without the listeners, cluster workers or
// process.exit() of the validator
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { deflateSync } from "node:zlib"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { loadConfig, ConfigError } from "../lib/config.mts"
import { ALL_IN_ONE_CONFIG, ALL_IN_ONE_SETTINGS, CSR_CONFIG, CSR_SETTINGS, defaultOptions, readConfigFile, runningConfiguration, serverOptions } from "../lib/config_file.mts"
import { ALL_IN_ONE_OPTIONS, CSR_OPTIONS, commandLineOptions } from "../lib/command_line.mts"
import { DEFAULT_USER_AGENT, setSystemSettings } from "../lib/globals.mts"
import { SLR_Processing_Modes } from "../lib/slepr.mts"
import { HasProperty } from "../lib/utils.mts"
import { createServices } from "../lib/services.mts"
import { createApp } from "../lib/app.mts"
import { Default_SLEPR } from "../lib/data_locations.mts"
import { configureFetchPolicy, safeFetch, setDocumentRevision, stopAllValidations, ValidationScope } from "../lib/safe_fetch.mts"
import { html, join as joinHTML, raw, text } from "../lib/html.mts"
import { PAGE_ASSETS } from "../lib/ui.mts"
import { Script, runInNewContext } from "node:vm"
import { setFlagsFromString } from "node:v8"
import { createHash, createPrivateKey, randomBytes, sign, X509Certificate } from "node:crypto"
import { createServer as createHTTPSServer } from "node:https"
import ErrorList, { DEBUG, INFORMATION, WARNING } from "../lib/error_list.mts"
import { ScheduleCoverage } from "../lib/schedule_coverage.mts"
import { IMAGE_VARIANTS, isImageVariant, urlImageVariant, withImageVariant, withoutImageVariant } from "../lib/image_variants.mts"
import { imageVariantOf } from "../lib/routes/request_handling.mts"
import { jsonResult } from "../lib/json_results.mts"
import { MARKET_DEFAULTS, MarketsError, NOT_OVERRIDABLE, addMarkets, definedMarkets, findMarket, marketSettings, marketSeverity, parseMarkets } from "../lib/markets.mts"
import { A177Revision } from "../lib/revisions.mts"

// an 8-bit RGBA (or RGB) PNG of a size, filled with one colour, or with pseudo-random pixels so that it does not compress (for the
// image size checks of markets, dvb-i-tools #119)
function testPNG(width: number, height: number, noise = false, alpha = true): Buffer {
	const crc = (bytes: Buffer) => {
		let c = ~0
		for (const b of bytes) {
			c ^= b
			for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
		}
		return ~c >>> 0
	}
	const chunk = (kind: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(kind, "latin1"), data])
		const out = Buffer.alloc(12 + data.length)
		out.writeUInt32BE(data.length, 0)
		body.copy(out, 4)
		out.writeUInt32BE(crc(body), 8 + data.length)
		return out
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, alpha ? 6 : 2, 0, 0, 0], 8) // RGBA, or RGB without an alpha channel (dvb-i-tools #153)
	const bytes = width * (alpha ? 4 : 3)
	const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), noise ? randomBytes(bytes) : Buffer.alloc(bytes, 0x80)])))
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}

// the command line options as all-in-one.ts gives them by default
const defaults = {
	nosl: false, nopl: false, nocg: false, noslr: false, noait: false, nocsr: false,
	CSRfile: Default_SLEPR.file, urls: false, SLRmode: "default",
	workers: 0, port: 0, sport: 0, allow_traversal: false, spam_blocker: false,
}

describe("Web application", () => {

	describe("loadConfig", () => {
		const rejects = (options: Record<string, unknown>, message: RegExp) =>
			assert.throws(() => loadConfig({ ...defaults, ...options }), (e: unknown) => e instanceof ConfigError && message.test((e as Error).message))

		test("nothing enabled", () => rejects({ nosl: true, nopl: true, nocg: true, noslr: true, noait: true, nocsr: true }, /nothing to do/))
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

	// the configuration files of the servers: all-in-one.json and csr.json in the program's folder, the file given with
	// --config over them, and the command line options over both (dvb-i-tools #147)
	describe("Configuration files", () => {
		const folder = mkdtempSync(join(tmpdir(), "dvbi-config-"))
		after(() => rmSync(folder, { recursive: true, force: true }))
		let n = 0
		// a configuration file in the test's folder, or in a folder of its own (sub)
		const file = (content: unknown, sub?: string) => {
			const dir = sub ? join(folder, sub) : folder
			mkdirSync(dir, { recursive: true })
			const name = join(dir, `config-${++n}.json`)
			writeFileSync(name, typeof content == "string" ? content : JSON.stringify(content))
			return name
		}
		const NONE = join(folder, "none.json") // a default file that does not exist
		const problemsOf = (content: unknown, settings = ALL_IN_ONE_SETTINGS) => {
			try {
				readConfigFile(file(content), settings)
			} catch (e) {
				assert.ok(e instanceof ConfigError)
				return (e as Error).message.split("\n").slice(1).map((line) => line.trim())
			}
			return []
		}

		test("every command line option is a setting of the server's file", () => {
			for (const [options, settings] of [[ALL_IN_ONE_OPTIONS, ALL_IN_ONE_SETTINGS], [CSR_OPTIONS, CSR_SETTINGS]] as const)
				for (const option of options.filter((o) => !["config", "help"].includes(o.name))) assert.ok(settings.some((s) => s.option == option.name), option.name)
		})
		test("the repository's files give the values coded in the validator, including the User-Agent", () => {
			for (const [config, settings] of [[ALL_IN_ONE_CONFIG, ALL_IN_ONE_SETTINGS], [CSR_CONFIG, CSR_SETTINGS]] as const) {
				const { options, given } = readConfigFile(config, settings)
				assert.deepEqual(options, Object.fromEntries(Object.entries(defaultOptions(settings)).filter(([option]) => HasProperty(options, option))), config)
				assert.equal(options.user_agent, "DVB-I validator", config)
				// every setting, except the spam blocker's endpoints, which belong to a deployment
				for (const setting of settings.filter((s) => !["spamBlocker.endpoints", "spamBlocker.protocol", "spamBlocker.redirections"].includes(s.path))) assert.ok(given.has(setting.path), `${config} ${setting.path}`)
			}
		})
		test("a configuration from the repository's file is the same as one from the coded values", () => {
			const { configFiles, ...fromFile } = loadConfig(serverOptions(ALL_IN_ONE_SETTINGS, {}, ALL_IN_ONE_CONFIG))
			const { configFiles: none, ...coded } = loadConfig(defaultOptions(ALL_IN_ONE_SETTINGS))
			assert.deepEqual(fromFile, coded)
			assert.deepEqual([configFiles, none], [[ALL_IN_ONE_CONFIG], []], "the files read")
		})
		test("the coded values, then the default file, then --config, then the command line", () => {
			const defaultFile = file({ server: { httpPort: 4000, httpsPort: 4001 }, fetch: { userAgent: "default file" } })
			const configFile = file({ server: { httpsPort: 5001 }, fetch: { userAgent: "Private agent/1.0" } })
			const options = serverOptions(ALL_IN_ONE_SETTINGS, { config: configFile, port: 6000 }, defaultFile)
			assert.deepEqual([options.port, options.sport, options.user_agent, options.fetch_concurrency], [6000, 5001, "Private agent/1.0", 8])
			assert.deepEqual(serverOptions(ALL_IN_ONE_SETTINGS, {}, defaultFile).user_agent, "default file", "without --config")
			assert.deepEqual(serverOptions(ALL_IN_ONE_SETTINGS, {}, NONE), { ...defaultOptions(ALL_IN_ONE_SETTINGS), config_files: [] }, "with no file")
		})
		test("a flag given on the command line without a value is true, and a feature turned off is its --no option", () => {
			const options = serverOptions(ALL_IN_ONE_SETTINGS, { allow_private_fetch: null, config: file({ features: { cg: false } }) }, NONE)
			assert.deepEqual([options.allow_private_fetch, options.nocg, options.nosl], [true, true, false])
			assert.deepEqual(loadConfig(options).features, { sl: true, pl: true, cg: false, slr: true, ait: true, csr: true })
		})
		test("a relative file name is relative to the folder of its configuration file", () => {
			const options = serverOptions(ALL_IN_ONE_SETTINGS, { config: file({ slr: { file: "registry.xml" }, server: { tls: { key: "../keys/server.key" } } }, "deployment") }, NONE)
			assert.equal(options.CSRfile, resolve(folder, "deployment", "registry.xml"))
			assert.equal(options.tls_key, resolve(folder, "keys", "server.key"))
		})
		test("a --config file that does not exist, or is not JSON", () => {
			assert.throws(() => serverOptions(ALL_IN_ONE_SETTINGS, { config: join(folder, "missing.json") }, NONE), (e: unknown) => e instanceof ConfigError && /does not exist/.test((e as Error).message))
			assert.throws(() => serverOptions(ALL_IN_ONE_SETTINGS, { config: file("{ not json") }, NONE), (e: unknown) => e instanceof ConfigError && /cannot be read as JSON/.test((e as Error).message))
		})
		test("every problem of a file is reported together", () => {
			assert.deepEqual(
				problemsOf({ server: { httpPort: 70000, tls: "key.pem", unknown: 1 }, fetch: { userAgent: "", timeoutMs: 0 }, traversal: { allowed: "yes" }, features: { sl: 1 }, other: {} }),
				[
					"server.httpPort must be a port number (0 to 65535)",
					"server.tls must be an object",
					"server.unknown is not a setting",
					"fetch.userAgent must be a string that is not empty",
					"fetch.timeoutMs must be a positive whole number",
					"traversal.allowed must be true or false",
					"features.sl must be true or false",
					"other is not a setting",
				]
			)
			assert.deepEqual(problemsOf({ server: { corsMode: "sideways", workers: -1 }, slr: { mode: "x" } }), [
				'server.corsMode must be one of "manual", "library", "none"',
				"server.workers must be a whole number, 0 or more",
				`slr.mode must be one of ${SLR_Processing_Modes.map((m) => JSON.stringify(m)).join(", ")}`,
			])
			assert.deepEqual(problemsOf([1]), ["the file must be an object"])
		})
		test("csr.json has only the settings of csr.ts", () => {
			assert.deepEqual(problemsOf({ traversal: { allowed: true }, features: { sl: false }, server: { maxDocumentBytes: 1000 } }, CSR_SETTINGS), [
				"traversal is not a setting",
				"features is not a setting",
				"server.maxDocumentBytes is not a setting",
			])
			assert.deepEqual(problemsOf({ server: { workers: 2 }, fetch: { userAgent: "csr" }, slr: { mode: "default" } }, CSR_SETTINGS), [])
		})
		test("the settings that have no command line option are checked by loadConfig too", () => {
			assert.throws(() => loadConfig({ ...defaults, max_document_bytes: 0, user_agent: "" }), (e: unknown) => e instanceof ConfigError && (e as Error).message == "server.maxDocumentBytes must be a positive whole number\nfetch.userAgent must be a string that is not empty")
			const config = loadConfig({ ...defaults, user_agent: "Agent/2", max_traversal: 250, max_depth: 4, shutdown_grace_ms: 2000 })
			assert.deepEqual([config.fetch.userAgent, config.traversal.maxDocuments, config.traversal.maxDepth, config.shutdownGraceMs], ["Agent/2", 250, 4, 2000])
			assert.deepEqual([loadConfig({ ...defaults }).fetch.userAgent, loadConfig({ ...defaults }).maxDocumentBytes], ["DVB-I validator", 10 * 1024 * 1024], "the coded values")
		})
		test("the spam blocker's section", () => {
			const section = { enabled: true, endpoints: ["/api", "/app"], protocol: "https", redirections: ["192.0.2.1", "2001:db8::1"] }
			const config = loadConfig({ ...defaults, ...serverOptions(ALL_IN_ONE_SETTINGS, { config: file({ spamBlocker: section }) }, NONE) })
			assert.deepEqual(config.spamBlocker, { endpoints: ["/api", "/app"], protocol: "https", redirections: ["192.0.2.1", "2001:db8::1"] })
			assert.equal(loadConfig({ ...defaults }).spamBlocker, undefined, "off")
			assert.deepEqual(loadConfig({ ...defaults, ...serverOptions(ALL_IN_ONE_SETTINGS, { config: file({ spamBlocker: { enabled: true } }) }, NONE) }).spamBlocker, { endpoints: [], protocol: "http", redirections: [] }, "with no endpoints")
		})
		test("the command line of each server", () => {
			const configFile = file({ server: { httpPort: 4100 }, fetch: { userAgent: "from --config" } })
			const options = commandLineOptions("all-in-one", ["--config", configFile, "--sport", "4200", "--nopl", "--allow_traversal"])
			assert.deepEqual([options.port, options.sport, options.user_agent, options.nopl, options.allow_traversal, options.nosl], [4100, 4200, "from --config", true, true, false])
			const csr = commandLineOptions("csr", ["--config", file({ server: { workers: 2 } }, "csr")])
			assert.deepEqual([csr.port, csr.workers, csr.user_agent], [3000, 2, "DVB-I validator"])
			assert.ok(!HasProperty(csr, "nosl"), "csr.ts has no validation settings")
		})
		test("the running configuration of /stats, without the values that are not to be published", async () => {
			const coded = runningConfiguration(ALL_IN_ONE_SETTINGS, loadConfig({ ...defaults, CSRfile: Default_SLEPR.file }).settings, [], ALL_IN_ONE_CONFIG)
			assert.equal(coded["configuration files"], "none (the coded values)")
			assert.deepEqual([coded["server.httpPort"], coded["fetch.timeoutMs"], coded["features.sl"], coded["server.corsMode"]], [0, 3000, "true", "library"])
			for (const path of ["fetch.userAgent", "server.tls.key", "slr.file", "files.archive", "spamBlocker.endpoints"]) assert.equal(coded[path], "(default)", path)
			assert.equal(Object.keys(coded).length, ALL_IN_ONE_SETTINGS.length + 1, "every setting")
			const secret = file({ server: { httpPort: 4000, tls: { key: "private/server.key" } }, fetch: { userAgent: "Secret agent/9.0" }, features: { cg: false }, spamBlocker: { enabled: true, endpoints: ["/hidden"], redirections: ["192.0.2.9"] } }, "secret")
			const config = loadConfig({ ...defaults, ...serverOptions(ALL_IN_ONE_SETTINGS, { config: secret }, ALL_IN_ONE_CONFIG) })
			const running = runningConfiguration(ALL_IN_ONE_SETTINGS, config.settings, config.configFiles, ALL_IN_ONE_CONFIG)
			assert.equal(running["configuration files"], "all-in-one.json, a --config file")
			assert.deepEqual([running["server.httpPort"], running["features.cg"], running["spamBlocker.enabled"]], [4000, "false", "true"])
			for (const path of ["fetch.userAgent", "server.tls.key", "spamBlocker.endpoints", "spamBlocker.redirections"]) assert.equal(running[path], "(set)", path)
			assert.equal(running["server.tls.certificate"], "(default)")
			// the page shows the table, and none of the values that are not to be published
			const app = createServer(createApp(config, createServices(loadConfig({ ...defaults, nopl: true, nocg: true, noslr: true, noait: true }))))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const page = await (await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/stats`)).text()
				assert.ok(page.includes("<h2>Configuration</h2>") && page.includes("<tr><td>server.httpPort</td><td>4000</td></tr>") && page.includes("<tr><td>fetch.userAgent</td><td>(set)</td></tr>"))
				for (const hidden of ["Secret agent", "server.key", "/hidden", "192.0.2.9", "secret", folder]) assert.ok(!page.includes(hidden), hidden)
			} finally {
				app.close()
			}
		})
		test("the User-Agent and the size limit of a document are those configured", async () => {
			let agent: string | undefined
			const server = createServer((req, res) => {
				agent = req.headers["user-agent"]
				res.end("ok")
			})
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			configureFetchPolicy({ allowPrivateAddresses: true })
			try {
				setSystemSettings({ userAgent: loadConfig({ ...defaults, user_agent: "Configured agent/3.0" }).fetch.userAgent })
				await safeFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
				assert.equal(agent, "Configured agent/3.0")
			} finally {
				setSystemSettings({ userAgent: DEFAULT_USER_AGENT })
				configureFetchPolicy({ allowPrivateAddresses: false })
				server.close()
			}
			const small = { ...defaults, nopl: true, nocg: true, noslr: true, noait: true, nocsr: true, max_document_bytes: 1000 }
			const app = createServer(createApp(loadConfig(small), createServices(loadConfig(small))))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const post = (size: number) => fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/validate_sl_json`, { method: "POST", body: "x".repeat(size), headers: { "Content-Type": "application/xml" } })
				assert.equal((await post(2000)).status, 413, "larger than server.maxDocumentBytes")
				assert.equal((await post(500)).status, 200)
			} finally {
				app.close()
			}
		})
	})

	describe("createApp", () => {
		// the service list endpoints and the registry only
		const options = { ...defaults, nopl: true, nocg: true, noslr: true, noait: true }
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

		test("only the enabled features are built", () => assert.ok(services.slcheck && services.csr && !services.cgcheck && !services.plcheck && !services.slrcheck && !services.aitcheck))
		test("the enabled routes respond", async () => {
			assert.equal(await status("/check"), 200)
			assert.equal(await status("/validate_sl_json?url=https://example.invalid/x"), 200)
			assert.equal(await status("/query"), 200)
			assert.equal(await status("/stats"), 200)
		})
		test("the routes of features not offered are not found", async () => {
			assert.equal(await status("/validate_cg_json"), 404)
			assert.equal(await status("/validate_pl"), 404)
			assert.equal(await status("/validate_ait_json"), 404)
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

	// the XML AIT validator (dvb-i-tools #134): the endpoints take the role of the AIT, and the form offers it
	describe("XML AIT", () => {
		const config = loadConfig({ ...defaults, nosl: true, nopl: true, nocg: true, noslr: true, nocsr: true })
		const services = createServices(config)
		// all its applications should have the same orgId and appId when it is a deep link or a template, but not as a linked application
		const differentIds = readFileSync(join(import.meta.dirname, "test-018", "deeplink", "0002 different appId.xml"), "utf8")
		let server: Server, base = ""
		before(async () => {
			server = createServer(createApp(config, services))
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		})
		after(() => server.close())
		const validate = async (query: string, body = differentIds) =>
			(await fetch(`${base}/validate_ait_json?results=all${query}`, { method: "POST", body, headers: { "Content-Type": "application/xml" } })).text()

		test("only the XML AIT checker is built", () => assert.ok(services.aitcheck && !services.slcheck && !services.cgcheck && !services.plcheck && !services.slrcheck && !services.csr))
		test("the role decides the rules", async () => {
			assert.ok((await validate("&role=deeplink")).includes('"AIT015"'), "a deep link")
			assert.ok((await validate("&role=template")).includes('"AIT015"'), "a template")
			assert.ok(!(await validate("&role=linked")).includes('"AIT015"'), "a linked application")
			assert.ok(!(await validate("")).includes('"AIT015"'), "linked is the default")
		})
		test("an unknown role is reported", async () => assert.ok((await validate("&role=sideways")).includes('"AIT009"')))
		test("urn:dvb:mhp:2009 is out of date, urn:dvb:mhp:2026 is the ETSI version", async () => {
			const old = JSON.parse(await validate("")).errs
			assert.ok(old.warnings.some((w: { code: string }) => w.code == "AIT006a"), "2009 is reported as out of date, with a warning")
			assert.ok(!old.errors.some((e: { code: string }) => e.code.startsWith("AIT006")), "an old schema is not an error")
			const current = await validate("", readFileSync(join(import.meta.dirname, "test-018", "linked", "0002 HbbTV application 2026.xml"), "utf8"))
			assert.ok(!current.includes('"AIT006a"') && !current.includes('"AIT006b"'), "2026 is neither out of date nor a draft")
		})
		test("the form offers XML AIT and its roles", async () => {
			const page = await (await fetch(`${base}/check`)).text()
			assert.ok(page.includes('id="radAIT" checked'), "XML AIT is the only, and so the selected, type")
			for (const role of ["linked", "deeplink", "template"]) assert.ok(page.includes(`name="aitRole" value="${role}"`), role)
			assert.ok(page.includes('name="aitRole" value="linked" id="ait-linked" checked'), "linked is the default role")
		})
		test("the form validates an uploaded AIT with the chosen role", async () => {
			const form = new FormData()
			form.set("testtype", "ait")
			form.set("doclocation", "file")
			form.set("aitRole", "template")
			form.set("XMLfile", new Blob([differentIds], { type: "application/xml" }), "ait.xml")
			const page = await (await fetch(`${base}/check`, { method: "POST", body: form })).text()
			assert.ok(page.includes("AIT015"), "the template rule is applied")
			assert.ok(page.includes('name="aitRole" value="template" id="ait-template" checked'), "the chosen role is shown again")
		})
		test("the form refuses an unknown role", async () => {
			const form = new FormData()
			form.set("testtype", "ait")
			form.set("doclocation", "file")
			form.set("aitRole", "sideways")
			form.set("XMLfile", new Blob([differentIds], { type: "application/xml" }), "ait.xml")
			assert.ok((await (await fetch(`${base}/check`, { method: "POST", body: form })).text()).includes("unknown XML AIT role"))
		})
	})

	// the XML AITs that service lists and content guides refer to are validated when the request asks for it (aits), with
	// the role of the element that refers to them (dvb-i-tools #134)
	describe("Referenced XML AITs", () => {
		const services = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }))
		const withoutAIT = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true, noait: true }))
		const AIT = "application/vnd.dvb.ait+xml"
		// an XML AIT with one HbbTV application, in the 2026 namespace unless the 2009 one is asked for
		const ait = (options: { ns?: string, appId?: string, policy?: string, icon?: boolean, urlBase?: string, location?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<mhp:ServiceDiscovery xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:mhp="${options.ns ?? "urn:dvb:mhp:2026"}">
	<mhp:ApplicationDiscovery DomainName="example.com">
		<mhp:ApplicationList>
			<mhp:Application>
				<mhp:appName Language="eng">Test application</mhp:appName>
				<mhp:applicationIdentifier><mhp:orgId>123</mhp:orgId><mhp:appId>${options.appId ?? "456"}</mhp:appId></mhp:applicationIdentifier>
				<mhp:applicationDescriptor>
					<mhp:type><mhp:OtherApp>application/vnd.hbbtv.xhtml+xml</mhp:OtherApp></mhp:type>
					<mhp:controlCode>AUTOSTART</mhp:controlCode>
					<mhp:visibility>VISIBLE_ALL</mhp:visibility>
					<mhp:serviceBound>false</mhp:serviceBound>
					<mhp:priority>1</mhp:priority>
					<mhp:version>01</mhp:version>
					<mhp:mhpVersion><mhp:profile>0</mhp:profile><mhp:versionMajor>1</mhp:versionMajor><mhp:versionMinor>8</mhp:versionMinor><mhp:versionMicro>1</mhp:versionMicro></mhp:mhpVersion>${options.icon ? `
					<mhp:icon mhp:filename="icon.png" mhp:aspectRatio="4_3"/>` : ""}
				</mhp:applicationDescriptor>
				<mhp:applicationTransport xsi:type="mhp:HTTPTransportType"><mhp:URLBase>${options.urlBase ?? "https://www.example.com/"}</mhp:URLBase></mhp:applicationTransport>
				<mhp:applicationLocation${options.policy ? ` mhp:verificationPolicy="${options.policy}"` : ""}>${options.location ?? "app.html"}</mhp:applicationLocation>
			</mhp:Application>
		</mhp:ApplicationList>
	</mhp:ApplicationDiscovery>
</mhp:ServiceDiscovery>`
		// the documents of the server: the body, its Content-Type and any other headers
		const documents: Record<string, { body: string, type: string, headers?: Record<string, string> }> = {
			"/linked.aitx": { body: ait({ policy: "urn:dvb:policies:signature:1" }), type: AIT },
			"/undefined-policy.aitx": { body: ait({ policy: "urn:dvb:policies:signature:9" }), type: AIT },
			"/provider.aitx": { body: ait(), type: AIT },
			"/provider-icon.aitx": { body: ait({ icon: true }), type: AIT },
			"/wrong-type.aitx": { body: ait(), type: "text/xml" },
			"/deeplink.aitx": { body: ait({ ns: "urn:dvb:mhp:2009" }), type: `${AIT}; charset=utf-8` },
			"/template.aitx": { body: ait(), type: AIT },
			"/template-max-age.aitx": { body: ait(), type: AIT, headers: { "Cache-Control": "public, max-age=3600" } },
			"/template-expires.aitx": { body: ait(), type: AIT, headers: { Expires: "Wed, 21 Oct 2037 07:28:00 GMT" } },
		}

		// the launch locations of applications, signed with the test key of res/jws/ (a detached Ed25519 JWS with an unencoded
		// payload, A177r8 clause 7.7.1.2), whose certificate is the trust anchor of urn:dvb:policies:signature:test
		const signingKey = createPrivateKey(readFileSync(join(import.meta.dirname, "res", "jws", "test-signing.key")))
		const signingCertificate = new X509Certificate(readFileSync(join(import.meta.dirname, "res", "jws", "test-signing.crt")))
		const jws = (body: string, header: object = { alg: "Ed25519", crit: ["b64"], b64: false, x5c: [signingCertificate.raw.toString("base64")] }) => {
			const protectedHeader = Buffer.from(JSON.stringify(header)).toString("base64url")
			return `${protectedHeader}..${sign(null, Buffer.concat([Buffer.from(`${protectedHeader}.`), Buffer.from(body)]), signingKey).toString("base64url")}`
		}
		const PAGE = "<!DOCTYPE html><html><head><title>Test application</title></head><body></body></html>"
		const REPORTING = { "Reporting-Endpoints": 'dvbi-signature-validation="https://reports.example.com/dvbi"' }
		const HTML = "text/html"
		Object.assign(documents, {
			"/app/signed.html": { body: PAGE, type: HTML, headers: { "X-JWS-Signature": jws(PAGE), ...REPORTING } },
			"/app/unsigned.html": { body: PAGE, type: HTML },
			"/app/tampered.html": { body: PAGE, type: HTML, headers: { "X-JWS-Signature": jws(PAGE.replace("Test", "Other")), ...REPORTING } },
			"/app/wrong-algorithm.html": { body: PAGE, type: HTML, headers: { "X-JWS-Signature": jws(PAGE, { alg: "HS256", crit: ["b64"], b64: false }), ...REPORTING } },
		})
		const launchAIT = (location: string, policy = "urn:dvb:policies:signature:test") => ({ body: ait({ policy, urlBase: "{base}/app/", location }), type: AIT })
		Object.assign(documents, {
			"/launch-signed.aitx": launchAIT("signed.html"),
			"/launch-unsigned.aitx": launchAIT("unsigned.html"),
			"/launch-tampered.aitx": launchAIT("tampered.html"),
			"/launch-wrong-algorithm.aitx": launchAIT("wrong-algorithm.html"),
			"/launch-other-anchor.aitx": launchAIT("signed.html", "urn:dvb:policies:signature:other"),
		})

		// the HTTPS test servers, with the certificates of res/tls/ (a valid one, and an expired one), and an https: port that is
		// not listening. The launch locations on them are "{tls}/app.html", "{expired}/app.html" and "{closed}/app.html"
		const tlsFile = (name: string) => readFileSync(join(import.meta.dirname, "res", "tls", name))
		const serverCertificate = new X509Certificate(tlsFile("test-server.crt")),
			expiredCertificate = new X509Certificate(tlsFile("test-expired.crt"))
		const tlsAIT = (host: string, policy: string) => ({ body: ait({ policy, urlBase: `{${host}}/`, location: "app.html" }), type: AIT })
		Object.assign(documents, {
			"/launch-tls.aitx": tlsAIT("tls", "urn:dvb:policies:signature:tls"),
			"/launch-tls-other-anchor.aitx": tlsAIT("tls", "urn:dvb:policies:signature:other"),
			"/launch-tls-expired.aitx": tlsAIT("expired", "urn:dvb:policies:signature:tls-expired"),
			"/launch-tls-host.aitx": tlsAIT("tls", "urn:dvb:policies:signature:tls-host"),
			"/launch-tls-closed.aitx": tlsAIT("closed", "urn:dvb:policies:signature:tls"),
			"/counted.aitx": { body: ait(), type: AIT },
		})
		// the requests the test server receives, by path
		const requests: Record<string, number> = {}
		const servers: Server[] = []
		const hosts: Record<string, string> = {}
		let server: Server, base = ""
		before(async () => {
			configureFetchPolicy({ allowPrivateAddresses: true })
			const listen = async (s: Server) => {
				servers.push(s)
				await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve))
				return (s.address() as AddressInfo).port
			}
			hosts.tls = `https://127.0.0.1:${await listen(createHTTPSServer({ key: tlsFile("test-server.key"), cert: tlsFile("test-server.crt") }, (_req, res) => res.end(PAGE)))}`
			hosts.expired = `https://127.0.0.1:${await listen(createHTTPSServer({ key: tlsFile("test-expired.key"), cert: tlsFile("test-expired.crt") }, (_req, res) => res.end(PAGE)))}`
			const closed = createServer()
			hosts.closed = `https://127.0.0.1:${await new Promise<number>((resolve) => closed.listen(0, "127.0.0.1", () => resolve((closed.address() as AddressInfo).port)))}`
			closed.close()
			server = createServer((req, res) => {
				requests[req.url ?? ""] = (requests[req.url ?? ""] ?? 0) + 1
				const doc = documents[req.url ?? ""]
				if (!doc) {
					res.statusCode = 404
					res.end()
					return
				}
				res.writeHead(200, { "Content-Type": doc.type, ...doc.headers })
				res.end(Object.entries({ base, ...hosts }).reduce((body, [name, url]) => body.replaceAll(`{${name}}`, url), doc.body))
			})
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		})
		after(() => {
			server.close()
			servers.forEach((s) => s.close())
			configureFetchPolicy({ allowPrivateAddresses: false })
		})

		// a service list with a signature policy, linked applications in its service instances, and a service provider application
		const serviceList = (instanceApps: string[], providerApp?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<ServiceList id="tag:dvb.org,2026:ait" version="1" xml:lang="en" xmlns="urn:dvb:metadata:servicediscovery:2026" xmlns:tva="urn:tva:metadata:2027" xmlns:dt="urn:dvb:metadata:servicediscovery-types:2026">
	<StandardVersion>urn:dvb:metadata:dvbi:standardversion:8</StandardVersion>
	<Name>Referenced XML AITs</Name>
	<ProviderName>Regression Test</ProviderName>
	<SignaturePolicies>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:1">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>www.dvb.org</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:test">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">${signingCertificate.fingerprint256}</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>127.0.0.1</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:tls">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">${serverCertificate.fingerprint256}</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>127.0.0.1</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:tls-expired">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">${expiredCertificate.fingerprint256}</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>127.0.0.1</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:tls-host">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">${serverCertificate.fingerprint256}</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>www.example.com</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
		<dt:SignaturePolicy policyId="urn:dvb:policies:signature:other">
			<dt:Enforcement>warn</dt:Enforcement>
			<dt:TrustAnchor><dt:CAFingerprint algorithm="sha256">ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90:ab:cd:ef:12:34:56:78:90</dt:CAFingerprint></dt:TrustAnchor>
			<dt:SubjectConstraint><dt:CN>127.0.0.1</dt:CN></dt:SubjectConstraint>
		</dt:SignaturePolicy>
	</SignaturePolicies>
	<Service version="1">
		<UniqueIdentifier>tag:dvb.org,2026:ait:svc1</UniqueIdentifier>${instanceApps.map((path, i) => `
		<ServiceInstance>
			<RelatedMaterial>
				<tva:HowRelated href="urn:dvb:metadata:cs:LinkedApplicationCS:2019:1.${i + 1}"/>
				<tva:MediaLocator><tva:MediaUri contentType="${AIT}">${base}${path}</tva:MediaUri></tva:MediaLocator>
			</RelatedMaterial>
		</ServiceInstance>`).join("")}
		<ServiceName>AIT service</ServiceName>
		<ProviderName>Regression Test</ProviderName>${providerApp ? `
		<RelatedMaterial>
			<tva:HowRelated href="urn:dvb:metadata:cs:LinkedApplicationCS:2019:3"/>
			<tva:MediaLocator><tva:MediaUri contentType="${AIT}">${base}${providerApp}</tva:MediaUri></tva:MediaLocator>
		</RelatedMaterial>` : ""}
	</Service>
</ServiceList>`
		// the results of each referenced AIT: its URL path, type, and codes
		const referenced = (errs: ErrorList) => errs.nestedErrors.filter((e) => e.type?.startsWith("XML AIT")).map((e) => ({
			path: (e.source ?? "").replace(base, ""),
			type: e.type,
			references: e.references,
			codes: (["errors", "warnings", "informationals"] as const).flatMap((list) => e.codesReported(list).map(([code]) => code)),
		}))
		const validateSL = async (text: string, aits = true, checker = services.slcheck!) => {
			const errs = new ErrorList()
			await checker.doValidateServiceList(text, errs, { aits, images: "no", report_schema_version: false })
			return { errs, aits: referenced(errs) }
		}

		test("the AITs are only validated when the request asks for it", async () => {
			assert.equal((await validateSL(serviceList(["/linked.aitx"]), false)).aits.length, 0)
			assert.equal((await validateSL(serviceList(["/linked.aitx"]), true, withoutAIT.slcheck!)).aits.length, 0, "nor when the server offers no XML AIT validation")
		})
		test("a linked application's AIT is validated, and its signature policy is that of the service list", async () => {
			const { aits } = await validateSL(serviceList(["/linked.aitx"]))
			assert.deepEqual(aits, [{ path: "/linked.aitx", type: "XML AIT-linked", references: 1, codes: [] }])
		})
		test("a signature policy that the service list does not define", async () => {
			const { aits } = await validateSL(serviceList(["/undefined-policy.aitx"]))
			assert.deepEqual(aits[0].codes, ["AIT027-2"])
		})
		test("an AIT delivered with another Content-Type, and one that is not found", async () => {
			const { aits } = await validateSL(serviceList(["/wrong-type.aitx", "/missing.aitx"]))
			assert.deepEqual(aits.map((a) => a.codes), [["AIT020"], ["AIT031"]])
		})
		test("an AIT is validated once, however often it is referenced", async () => {
			const { aits } = await validateSL(serviceList(["/linked.aitx", "/linked.aitx"]))
			assert.equal(aits.length, 1)
			assert.equal(aits[0].references, 2)
		})
		test("a service provider application may have icons", async () => {
			assert.deepEqual((await validateSL(serviceList([], "/provider.aitx"))).aits[0].codes, ["AIT029"])
			assert.deepEqual((await validateSL(serviceList([], "/provider-icon.aitx"))).aits[0].codes, [], "with an icon")
			assert.deepEqual((await validateSL(serviceList(["/provider.aitx"]))).aits[0].codes, [], "not for an application of a service instance")
		})
		test("the AITs of an On Demand programme are a deep link and a template, and the template's caching is checked", async () => {
			const dpi = readFileSync(join(import.meta.dirname, "test-004", "0001r8 DPI.xml"), "utf8")
			const validateDPI = async (deeplink: string, template: string) => {
				const errs = new ErrorList()
				const text = dpi.replace("https://channel7.co.uk/ait.aitx?pid=b01myjsy", `${base}${deeplink}`).replace("https://channel7.co.uk/ait.aitx?template", `${base}${template}`)
				await services.cgcheck!.doValidateContentGuide(text, "ProgInfo", errs, { aits: true, images: "no", report_schema_version: false })
				return referenced(errs)
			}
			assert.deepEqual(await validateDPI("/deeplink.aitx", "/template.aitx"), [
				{ path: "/deeplink.aitx", type: "XML AIT-deeplink", references: 1, codes: [] },
				{ path: "/template.aitx", type: "XML AIT-template", references: 1, codes: ["AIT021"] },
			])
			assert.deepEqual((await validateDPI("/deeplink.aitx", "/template-max-age.aitx"))[1].codes, [], "with Cache-Control: max-age")
			assert.deepEqual((await validateDPI("/deeplink.aitx", "/template-expires.aitx"))[1].codes, [], "with Expires")
		})
		test("a restart link is a deep link and a template, also without @contentType", async () => {
			const restart = async (file: string) => {
				const text = readFileSync(join(import.meta.dirname, "test-008", file), "utf8")
					.replace("https://channel7.co.uk/restart/programme.aitx", `${base}/deeplink.aitx`)
					.replace("https://channel7.co.uk/restart/template.aitx", `${base}/template-max-age.aitx`)
				const errs = new ErrorList()
				await services.cgcheck!.doValidateContentGuide(text, "NowNext", errs, { aits: true, images: "no", report_schema_version: false })
				return { aits: referenced(errs), warnings: errs.codesReported("warnings") }
			}
			const both = [
				{ path: "/deeplink.aitx", type: "XML AIT-deeplink", references: 1, codes: [] },
				{ path: "/template-max-age.aitx", type: "XML AIT-template", references: 1, codes: [] },
			]
			assert.deepEqual((await restart("0101r8 NN restart check.xml")).aits, both)
			const omitted = await restart("0104r8 NN restart without contentType.xml")
			assert.deepEqual(omitted.aits, both, "application/vnd.dvb.ait+xml is assumed")
			assert.deepEqual(omitted.warnings, [["RR004", 2]])
			assert.deepEqual((await restart("0106r8 NN restart other contentType.xml")).aits, [both[1]], "a MediaUri of another type is not retrieved")
		})
		test("the AITs of box sets are templates", async () => {
			const lists = readFileSync(join(import.meta.dirname, "test-010", "0001r8 bsList.xml"), "utf8")
				.replace("https://www.live.mybroadcastertvapps.co.uk/tap/iplayer/ait/launch/iplayer.aitx", `${base}/template-max-age.aitx`)
				.replace("https://ait.channel4.com/ait/template", `${base}/template.aitx`)
			const errs = new ErrorList()
			await services.cgcheck!.doValidateContentGuide(lists, "bsLists", errs, { aits: true, images: "no", report_schema_version: false })
			assert.deepEqual(referenced(errs), [
				{ path: "/template-max-age.aitx", type: "XML AIT-template", references: 1, codes: [] },
				{ path: "/template.aitx", type: "XML AIT-template", references: 1, codes: ["AIT021"] },
			])
		})
		test("a /validate_* endpoint asks for it with aits / X-aits", async () => {
			const app = createServer(createApp(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }), services))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}/validate_sl_json?results=all`
				const post = async (headers: Record<string, string>) => (await fetch(url, { method: "POST", body: serviceList(["/wrong-type.aitx"]), headers: { "Content-Type": "application/xml", ...headers } })).text()
				assert.ok((await post({ "X-aits": "true" })).includes('"AIT020"'))
				assert.ok(!(await post({})).includes('"AIT020"'))
			} finally {
				app.close()
			}
		})
		test("the traversed documents of the HTML results open each AIT's validation, with its role", async () => {
			const app = createServer(createApp(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }), services))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const server = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
				const page = await (await fetch(`${server}/validate_sl`, { method: "POST", body: serviceList(["/wrong-type.aitx"], "/provider.aitx"), headers: { "Content-Type": "application/xml", "X-aits": "true" } })).text()
				const link = (path: string) => `${server}/validate_ait?url=${encodeURIComponent(base + path)}&role=linked`
				for (const path of ["/wrong-type.aitx", "/provider.aitx"]) assert.ok(page.includes(`href="${link(path).replaceAll("&", "&amp;")}"`), `a link to the validation of ${path}`)
				// the link validates the AIT on its own, as the traversal did (the Content-Type is only checked when it is referenced)
				const own = await (await fetch(link("/provider.aitx"))).text()
				assert.ok(own.includes("mhp:ServiceDiscovery") && own.includes('class="all-clear"'), "with a role the endpoint accepts")
				// the links keep the market of the validation, so that the document is validated with the same settings
				assert.ok(!page.includes("market="), "no market when the validation is for none")
				addMarkets(parseMarkets(JSON.stringify([{ id: "APP-LINKS", name: "Links", revisions: [{ from: "r0", to: "latest" }] }]), "test-app"))
				const forMarket = await (await fetch(`${server}/validate_sl`, { method: "POST", body: serviceList(["/wrong-type.aitx"]), headers: { "Content-Type": "application/xml", "X-aits": "true", "X-market": "APP-LINKS" } })).text()
				assert.ok(forMarket.includes(`href="${(link("/wrong-type.aitx") + "&market=APP-LINKS").replaceAll("&", "&amp;")}"`), "the market of the validation")
			} finally {
				app.close()
			}
		})
		test("for the market DE, an AIT in urn:dvb:mhp:2009 is not a warning: AIT006a is suppressed", async () => {
			const OLD = ait({ ns: "urn:dvb:mhp:2009" })
			const validate = async (market?: string) => {
				const errs = new ErrorList()
				await services.aitcheck!.doValidateXmlAit(OLD, "linked", errs, { market, report_schema_version: true })
				return errs
			}
			const without = await validate()
			assert.deepEqual([without.warnings.some((e) => e.code == "AIT006a"), without.numSuppressed()], [true, 0], "a warning without a market")
			const de = await validate("DE")
			assert.ok(!de.warnings.some((e) => e.code == "AIT006a"), "not a warning for DE")
			assert.deepEqual(de.suppressed.map((e) => e.code), ["AIT006a"])
			assert.ok(de.suppressed[0].message.endsWith("(a warning in A177, suppressed for the market DE)"), de.suppressed[0].message)
			// the HTML results show it in its own table, and the JSON results count it
			const app = createServer(createApp(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }), services))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const server = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
				const post = async (path: string) => (await fetch(`${server}${path}?role=linked`, { method: "POST", body: OLD, headers: { "Content-Type": "application/xml", "X-market": "DE" } })).text()
				const page = await post("/validate_ait")
				assert.ok(page.includes('<details class="section s-supp" id="suppressed"'), "a table of the suppressed findings")
				assert.ok(page.includes("Suppressed by the market Germany (DE)"))
				assert.ok(page.includes('href="#suppressed"><span class="n">1</span><span class="label">suppressed by the market</span>'), "and its count")
				assert.ok(page.includes("Suppressed AIT006a"), "marked as suppressed in the listing")
				const json = JSON.parse(await post("/validate_ait_json"))
				assert.equal(json.suppressed, 1)
				assert.ok(!(await (await fetch(`${server}/validate_ait?role=linked`, { method: "POST", body: OLD, headers: { "Content-Type": "application/xml" } })).text()).includes('id="suppressed"'), "nothing suppressed without the market")
			} finally {
				app.close()
			}
		})
		test("the response of a launch location is checked against its signature policy", async () => {
			// response signatures are checked by the server (not by default for direct validations), for the launch locations
			// of this test only: the other test AITs have launch locations on www.example.com, which are not retrieved
			configureFetchPolicy({ checkResponseSignatures: true })
			try {
				const codes = async (path: string, responseSignatures = true) => {
					const errs = new ErrorList()
					await services.slcheck!.doValidateServiceList(serviceList([path]), errs, { aits: true, images: "no", report_schema_version: false, responseSignatures })
					return referenced(errs)[0].codes.sort()
				}
				// the test server is http, so each launch location also has AIT027-3
				assert.deepEqual(await codes("/launch-signed.aitx"), ["AIT027-3"], "a valid signature")
				assert.deepEqual(await codes("/launch-unsigned.aitx"), ["AIT027-3", "JWS001"], "no X-JWS-Signature")
				assert.deepEqual(await codes("/launch-tampered.aitx"), ["AIT027-3", "JWS005"], "a signature of another body")
				assert.deepEqual(await codes("/launch-wrong-algorithm.aitx"), ["AIT027-3", "JWS003"], "an algorithm that is not allowed")
				assert.deepEqual(await codes("/launch-other-anchor.aitx"), ["AIT027-3", "JWS007"], "a certificate that is not the policy's trust anchor")
				assert.deepEqual(await codes("/launch-unsigned.aitx", false), ["AIT027-3"], "the request turns the check off")
			} finally {
				configureFetchPolicy({ checkResponseSignatures: false })
			}
			// a validation not made through the server does not check response signatures
			const errs = new ErrorList()
			await services.slcheck!.doValidateServiceList(serviceList(["/launch-unsigned.aitx"]), errs, { aits: true, images: "no", report_schema_version: false })
			assert.deepEqual(referenced(errs)[0].codes, ["AIT027-3"])
		})
		test("the certificate chain of a launch location's server is checked against its signature policy", async () => {
			// connection certificates are checked by the server (not by default for direct validations), for this test only.
			// Response signatures are not checked: the test servers' certificates are not trusted, so their pages are not retrieved
			configureFetchPolicy({ checkConnectionCertificates: true })
			try {
				const codes = async (path: string, connectionCertificates = true) => {
					const errs = new ErrorList()
					await services.slcheck!.doValidateServiceList(serviceList([path]), errs, { aits: true, images: "no", report_schema_version: false, responseSignatures: false, connectionCertificates })
					return referenced(errs)[0].codes.sort()
				}
				assert.deepEqual(await codes("/launch-tls.aitx"), [], "a chain with the policy's trust anchor")
				assert.deepEqual(await codes("/launch-tls-other-anchor.aitx"), ["TLS001"], "a chain without the policy's trust anchor")
				assert.deepEqual(await codes("/launch-tls-expired.aitx"), ["TLS003"], "an expired certificate")
				assert.deepEqual(await codes("/launch-tls-host.aitx"), ["TLS004"], "a host that the SubjectConstraint does not permit")
				assert.deepEqual(await codes("/launch-tls-closed.aitx"), ["TLS002"], "a chain that cannot be obtained")
				assert.deepEqual(await codes("/launch-tls-other-anchor.aitx", false), [], "the request turns the check off")
			} finally {
				configureFetchPolicy({ checkConnectionCertificates: false })
			}
		})
		test("an AIT with a content digest is retrieved once for the digest and its validation", async () => {
			const digest = createHash("sha256").update(documents["/counted.aitx"].body).digest("hex")
			const withDigest = (value: string) => serviceList(["/counted.aitx"]).replace(`contentType="${AIT}">${base}/counted.aitx`, `contentType="${AIT}" integrity="sha256=:${value}:">${base}/counted.aitx`)
			const validate = async (text: string, aits: boolean) => {
				requests["/counted.aitx"] = 0
				const errs = new ErrorList()
				await services.slcheck!.doValidateServiceList(text, errs, { aits, images: "no", report_schema_version: false })
				return { requests: requests["/counted.aitx"], aits: referenced(errs), digestErrors: errs.codesReported("errors").filter(([code]) => code.startsWith("SA015")) }
			}
			assert.deepEqual(await validate(withDigest(digest), true), { requests: 1, aits: [{ path: "/counted.aitx", type: "XML AIT-linked", references: 1, codes: [] }], digestErrors: [] }, "validated, and the digest matches")
			assert.deepEqual(await validate(withDigest(digest), false), { requests: 1, aits: [], digestErrors: [] }, "only the digest, without aits")
			const wrong = await validate(withDigest("0".repeat(64)), true)
			assert.equal(wrong.requests, 1)
			assert.equal(wrong.aits.length, 1, "the AIT is validated")
			assert.equal(wrong.digestErrors.length, 1, "the wrong digest is reported")
			assert.equal((await validate(serviceList(["/counted.aitx"]), true)).requests, 1, "without a digest")
		})
		test("the form offers it for service lists, registries and content guides", async () => {
			const app = createServer(createApp(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }), services))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			try {
				const page = await (await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/check`)).text()
				assert.ok(page.includes('class="check ait-options"><input type="checkbox" id="cbAITs" name="aits">'))
			} finally {
				app.close()
			}
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
		// A177r8 clause 5.2.8.2.1: every endpoint accepts the image variants of table 8, and refuses other values (issue #153)
		test("an image variant is accepted, and gives the same response", async () => {
			const plain = csr.processServiceListRequest({}, undefined).body
			for (const variant of ["16x9_colour", "square_colour_light", "2x3_colour_dark"]) {
				const response = csr.processServiceListRequest({ image_variant: variant }, undefined)
				assert.equal(response.status, 200, variant)
				assert.equal(response.body, plain, variant)
			}
			assert.equal((await fetch(base + "/query?TargetCountry=DEU&image_variant=16x9_colour_dark")).status, 200)
		})
		test("an image variant that is not in table 8 is refused", async () => {
			assert.deepEqual(csr.processServiceListRequest({ image_variant: "16x9_grey" }, undefined).parseErr, ["invalid image_variant [16x9_grey]"])
			assert.equal(csr.processServiceListRequest({ image_variant: "16X9_COLOUR" }, undefined).status, 400, "the values are in lower case")
			assert.deepEqual(csr.processServiceListRequest({ image_variant: ["16x9_colour", "square_colour"] }, undefined).parseErr, ["only a single &image_variant can be specified"])
			assert.equal((await fetch(base + "/query?image_variant=none")).status, 400)
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
	// the markets of res/markets.json, and how a validation is made for one (dvb-i-tools #119)
	describe("Markets", () => {
		const options = { ...defaults, nopl: true, nocg: true, noslr: true, noait: true, nocsr: true }
		const services = createServices(loadConfig(options))
		let server: Server, base = ""
		before(async () => {
			server = createServer(createApp(loadConfig(options), services))
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		})
		after(() => server.close())

		test("the markets of res/markets.json", () => {
			assert.deepEqual(JSON.parse(readFileSync(join(import.meta.dirname, "..", "res", "markets.json"), "utf8")).map((m: { id: string }) => m.id), ["DE"])
			assert.ok(definedMarkets().some((m) => m.id == "DE"))
			assert.equal(findMarket("de")?.id, "DE", "an id is found in any case")
			assert.equal(findMarket(" DE "), findMarket("DE"))
			assert.equal(findMarket("IT"), undefined)
		})
		test("the German market: only A177r6, with 7 days of schedule and its own schemas", () => {
			const de = findMarket("DE")!
			assert.deepEqual(de.permitted, [A177Revision.r6])
			for (const revision of A177Revision.all) {
				const settings = de.settings(revision)
				assert.equal(settings.market, "DE")
				const r6 = revision == A177Revision.r6
				assert.equal(de.permits(revision), r6, String(revision))
				assert.deepEqual(settings.parameters.schedule, r6 ? { daysBefore: 7, daysAfter: 7 } : { daysBefore: 28, daysAfter: 28 }, String(revision))
				assert.equal(settings.schemas.serviceList?.filename.endsWith("dvbi_v6.0+hls+hbbtv-(DE).xsd") ?? false, r6, String(revision))
				assert.equal(settings.schemas.serviceListRegistry?.filename.endsWith("dvbi_service_list_discovery_v1.6+hls-(DE).xsd") ?? false, r6, String(revision))
				assert.ok(Object.isFrozen(settings) && Object.isFrozen(settings.parameters.schedule))
			}
			assert.deepEqual(de.settings(A177Revision.unknown).parameters.schedule, { daysBefore: 28, daysAfter: 28 }, "a document whose revision is not known has the A177 baseline")
		})
		test("without a market the settings are those of A177", () => {
			assert.equal(marketSettings(undefined, A177Revision.r6), MARKET_DEFAULTS)
			assert.deepEqual(MARKET_DEFAULTS.parameters.schedule, { daysBefore: 28, daysAfter: 28 }, "A177r8 clause 6.1")
			assert.deepEqual(MARKET_DEFAULTS.parameters.icecast, {}, "A177 gives no Icecast media types")
			assert.deepEqual(MARKET_DEFAULTS.schemas, {})
			assert.deepEqual(MARKET_DEFAULTS.parameters.lcn, { min: 1, max: 9999 }, "A177 table 23")
			assert.deepEqual(MARKET_DEFAULTS.severity, {})
		})

		describe("a markets file that cannot be used", () => {
			const problems = (markets: unknown): string[] => {
				try {
					parseMarkets(JSON.stringify(markets), "test.json")
				} catch (err) {
					assert.ok(err instanceof MarketsError)
					return (err as Error).message.split("\n").slice(1).map((p) => p.trim())
				}
				assert.fail("the markets are accepted")
			}
			const market = (revisions: unknown[], more: Record<string, unknown> = {}) => [{ id: "XX", name: "Test", revisions, ...more }]
			const where = 'test.json: market "XX", revision range 1:'
			test("a file that is not JSON, or not an array", () => {
				assert.throws(() => parseMarkets("[{", "test.json"), (e: unknown) => e instanceof MarketsError && /not valid JSON/.test((e as Error).message))
				assert.throws(() => parseMarkets("{}", "test.json"), (e: unknown) => e instanceof MarketsError && /must be an array of markets/.test((e as Error).message))
			})
			test("a legitimate market, and an empty list", () => {
				const [m] = parseMarkets(JSON.stringify(market([{ from: "r7", to: "latest", parameters: { schedule: { daysBefore: 1, daysAfter: 2 } } }])), "test.json")
				assert.deepEqual(m.settings(A177Revision.r6).parameters.schedule, { daysBefore: 28, daysAfter: 28 }, "before the range")
				assert.deepEqual(m.settings(A177Revision.r7).parameters.schedule, { daysBefore: 1, daysAfter: 2 }, "the lowest value")
				assert.deepEqual(m.settings(A177Revision.r8).parameters.schedule, { daysBefore: 1, daysAfter: 2 }, "latest")
				assert.deepEqual(parseMarkets("[]", "test.json"), [])
			})
			test("a later range wins", () => {
				const ranges = [
					{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 7, daysAfter: 7 } } },
					{ from: "r8", to: "r8", parameters: { schedule: { daysAfter: 14 } } },
				]
				const [m] = parseMarkets(JSON.stringify(market(ranges)), "test.json")
				assert.deepEqual(m.settings(A177Revision.r7).parameters.schedule, { daysBefore: 7, daysAfter: 7 })
				assert.deepEqual(m.settings(A177Revision.r8).parameters.schedule, { daysBefore: 7, daysAfter: 14 }, "only the days after are replaced")
			})
			test("the id, the name and the description", () => {
				const range = [{ from: "r0", to: "r8" }]
				assert.deepEqual(problems([{ name: "Test", revisions: range }]), ["test.json: market 1: id must be letters, digits, - or _"])
				assert.deepEqual(problems([{ id: "a b", name: "Test", revisions: range }]), ["test.json: market 1: id must be letters, digits, - or _"])
				assert.deepEqual(problems([{ id: "XX", revisions: range }]), ['test.json: market "XX": name must be given'])
				assert.deepEqual(problems([...market(range), { id: "xx", name: "Again", revisions: range }]), ['test.json: market "xx" is defined more than once'])
				assert.deepEqual(problems(market(range, { description: 1 })), ['test.json: market "XX": description must be text'])
				assert.deepEqual(problems(["DE"]), ["test.json: market 1 is not an object"])
			})
			test("unknown properties", () => {
				assert.deepEqual(problems(market([{ from: "r0", to: "r8" }], { severity: {} })), ['test.json: market "XX": unknown property "severity"'])
				assert.deepEqual(problems(market([{ from: "r0", to: "r8", colours: {} }])), [`${where} unknown property "colours"`])
			})
			test("the revision ranges", () => {
				assert.deepEqual(problems(market([])), ['test.json: market "XX": revisions must be a list of revision ranges'])
				assert.deepEqual(problems(market([{ from: "r9", to: "latest" }])), [`${where} from must be a revision of A177 (r0 to r8, or latest)`])
				assert.deepEqual(problems(market([{ from: "r0", to: 8 }])), [`${where} to must be a revision of A177 (r0 to r8, or latest)`])
				assert.deepEqual(problems(market([{ from: "r7", to: "r6" }])), [`${where} from is after to`])
				assert.deepEqual(problems(market(["r6"])), ['test.json: market "XX", revision range 1 is not an object'])
			})
			test("the parameters", () => {
				const range = (parameters: unknown) => problems(market([{ from: "r0", to: "r8", parameters }]))
				assert.deepEqual(range({ logo: { width: 1 } }), [`${where} unknown parameter "logo"`])
				assert.deepEqual(range({ schedule: { days: 7 } }), [`${where} "schedule.days" is not a parameter`])
				assert.deepEqual(range({ schedule: 7 }), [`${where} parameter "schedule" must be an object`])
				assert.deepEqual(range({ postcode: { digits: 0 } }), [`${where} "postcode.digits" must be a positive whole number`])
				assert.deepEqual(parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8", parameters: { postcode: { digits: 4 } } }])), "test.json")[0].settings(A177Revision.r8).parameters.postcode, { digits: 4 })
				assert.deepEqual(MARKET_DEFAULTS.parameters.postcode, {}, "A177 gives no postcode format")
				assert.deepEqual(range([]), [`${where} parameters must be an object`])
				// the days before and after today: 0 or more (today itself is always needed)
				for (const name of ["daysBefore", "daysAfter"]) {
					for (const value of [-1, 1.5, "7", null])
						assert.deepEqual(range({ schedule: { [name]: value } }), [`${where} "schedule.${name}" must be a whole number`], `${name} ${String(value)}`)
					assert.equal(parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8", parameters: { schedule: { [name]: 0 } } }])), "test.json")[0].settings(A177Revision.r8).parameters.schedule[name as "daysBefore" | "daysAfter"], 0, `${name} 0`)
				}
				assert.deepEqual(range({ schedule: { daysEitherSide: 7 } }), [`${where} "schedule.daysEitherSide" is not a parameter`], "replaced by daysBefore and daysAfter")
				// the media types of an Icecast service instance (#139 DE-6)
				const icecast = (contentTypes: string[]) => parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8", parameters: { icecast: { contentTypes } } }])), "test.json")[0].settings(A177Revision.r8).parameters.icecast
				assert.deepEqual(icecast(["audio/mpeg", "audio/aac"]), { contentTypes: ["audio/mpeg", "audio/aac"] })
				assert.deepEqual(icecast(["audio/ogg"]), { contentTypes: ["audio/ogg"] }, "one media type")
				for (const value of [[], "audio/mpeg", ["audio"], ["audio/mpeg", 3], ["audio/ mpeg"], null])
					assert.deepEqual(range({ icecast: { contentTypes: value } }), [`${where} "icecast.contentTypes" must be a list of media types`], JSON.stringify(value))
			})
			test("the LCN range", () => {
				const settings = (ranges: unknown[]) => parseMarkets(JSON.stringify(market(ranges)), "test.json")[0]
				assert.deepEqual(settings([{ from: "r0", to: "latest", parameters: { lcn: { min: 10, max: 99 } } }]).settings(A177Revision.r8).parameters.lcn, { min: 10, max: 99 })
				assert.deepEqual(settings([{ from: "r8", to: "r8", parameters: { lcn: { max: 99 } } }]).settings(A177Revision.r8).parameters.lcn, { min: 1, max: 99 }, "only the maximum")
				assert.deepEqual(settings([{ from: "r0", to: "r8", parameters: { lcn: { min: 5, max: 5 } } }]).settings(A177Revision.r0).parameters.lcn, { min: 5, max: 5 }, "one number")
				assert.deepEqual(problems(market([{ from: "r0", to: "r8", parameters: { lcn: { min: 0 } } }])), [`${where} "lcn.min" must be a positive whole number`])
				assert.deepEqual(problems(market([{ from: "r7", to: "r8", parameters: { lcn: { min: 100, max: 99 } } }])), ['test.json: market "XX": "lcn.min" is above "lcn.max" for r7 (100 > 99), r8 (100 > 99)'])
				assert.deepEqual(problems(market([{ from: "r8", to: "r8", parameters: { lcn: { min: 10000 } } }])), ['test.json: market "XX": "lcn.min" is above "lcn.max" for r8 (10000 > 9999)'], "above A177's maximum")
			})
			test("the severities", () => {
				const range = (severity: unknown) => problems(market([{ from: "r8", to: "r8", severity }]))
				const [m] = parseMarkets(JSON.stringify(market([{ from: "r8", to: "r8", severity: { SL264: "warning", "SI020-1-*": "off", "AV051-53": "information", SL244: "error", SL262: "suppressed" } }])), "test.json")
				assert.deepEqual(m.settings(A177Revision.r8).severity, { SL264: "warning", "SI020-1-*": "off", "AV051-53": "information", SL244: "error", SL262: "suppressed" })
				assert.deepEqual(m.settings(A177Revision.r7).severity, {}, "outside the range")
				assert.deepEqual(range([]), [`${where} severity must be an object`])
				for (const key of ["sl264", "SL26", "SL*", "*", "SL264 ", "SL2645*x"])
					assert.deepEqual(range({ [key]: "warning" }), [`${where} severity ${JSON.stringify(key)} is not a code, or a prefix of codes followed by *`], key)
				for (const value of ["fatal", "Error", "", 1, null])
					assert.deepEqual(range({ SL264: value }), [`${where} severity "SL264" must be one of "error", "warning", "information", "suppressed", "off"`], String(value))
			})
			test("the severities of fatal and XSD findings cannot be changed", () => {
				const range = (severity: unknown) => problems(market([{ from: "r8", to: "r8", severity }]))
				for (const key of [...NOT_OVERRIDABLE, "SL005:8", "SL005a", "SL001-1", "CG003:3", "SL005*", "SL005:*", "AIT005*"])
					assert.deepEqual(range({ [key]: "warning" }), [`${where} the severity of ${JSON.stringify(key)} cannot be changed (a fatal or XSD finding)`], key)
				const other = parseMarkets(JSON.stringify(market([{ from: "r8", to: "r8", severity: { SL0051: "warning", "SL00511*": "off" } }])), "test.json")[0]
				assert.deepEqual(other.settings(A177Revision.r8).severity, { SL0051: "warning", "SL00511*": "off" }, "other codes that start with the same digits")
			})
			test("a later range wins for a severity", () => {
				const [m] = parseMarkets(JSON.stringify(market([{ from: "r0", to: "latest", severity: { SL264: "warning" } }, { from: "r8", to: "r8", severity: { SL264: "off" } }])), "test.json")
				assert.equal(m.settings(A177Revision.r7).severity.SL264, "warning")
				assert.equal(m.settings(A177Revision.r8).severity.SL264, "off")
			})
			test("the permitted revisions", () => {
				const [m] = parseMarkets(JSON.stringify(market([{ from: "r6", to: "r7" }], { permitted: ["r7", "r6"] })), "test.json")
				assert.deepEqual(m.permitted, [A177Revision.r6, A177Revision.r7], "in the order of the revisions")
				assert.ok(!m.permits(A177Revision.r5) && m.permits(A177Revision.r6) && m.permits(A177Revision.r7) && !m.permits(A177Revision.r8), "only those listed")
				const [all] = parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8" }])), "test.json")
				assert.ok(A177Revision.all.every((r) => all.permits(r)) && all.permitted == undefined, "every revision without a list")
				assert.deepEqual(parseMarkets(JSON.stringify(market([{ from: "r8", to: "r8" }], { permitted: ["latest"] })), "test.json")[0].permitted, [A177Revision.r8], "latest")
				assert.deepEqual(problems(market([{ from: "r6", to: "r6" }], { permitted: [] })), ['test.json: market "XX": permitted must be a list of A177 revisions'])
				assert.deepEqual(problems(market([{ from: "r6", to: "r6" }], { permitted: "r6" })), ['test.json: market "XX": permitted must be a list of A177 revisions'])
				assert.deepEqual(problems(market([{ from: "r6", to: "r6" }], { permitted: ["r6", "r9"] })), ['test.json: market "XX": permitted revision "r9" is not a revision of A177 (r0 to r8, or latest)'])
				assert.deepEqual(problems(market([{ from: "r6", to: "r6" }, { from: "r7", to: "latest" }], { permitted: ["r6"] })), ['test.json: market "XX", revision range 2: includes no revision that the market permits'])
				assert.deepEqual(problems(market([{ from: "r8", to: "r8", severity: { MKT001: "off" } }])), [`${where} the severity of "MKT001" cannot be changed (a fatal or XSD finding)`], "the refusal cannot be turned off")
			})
			test("the images", () => {
				const range = (images: unknown) => problems(market([{ from: "r8", to: "r8", images }]))
				const images = (images: unknown, ranges: unknown[] = []) => parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8", images }, ...ranges])), "test.json")[0]
				assert.deepEqual(images({ serviceLogo: { width: 320 }, promotionalStillImage: { width: 640, maxBytes: 102400 }, serviceListLogo: { width: 1, height: 1 }, contentGuideSourceLogo: { maxBytes: 1 } }).settings(A177Revision.r8).images, {
					serviceLogo: { width: 320 },
					promotionalStillImage: { width: 640, maxBytes: 102400 },
					serviceListLogo: { width: 1, height: 1 },
					contentGuideSourceLogo: { maxBytes: 1 },
				}, "width only, width and file size, the smallest size, file size only")
				assert.deepEqual(images({ serviceLogo: { width: 320, maxBytes: 100 } }, [{ from: "r8", to: "r8", images: { serviceLogo: { width: 256 } } }]).settings(A177Revision.r8).images, { serviceLogo: { width: 256 } }, "a later range replaces a kind")
				assert.deepEqual(range([]), [`${where} images must be an object`])
				assert.deepEqual(range({ serviceBanner: { width: 1 } }), [`${where} unknown kind of image "serviceBanner"`])
				assert.deepEqual(range({ serviceLogo: 320 }), [`${where} image "serviceLogo" must be an object`])
				assert.deepEqual(range({ serviceLogo: { height: 9 } }), [`${where} image "serviceLogo": a height needs a width`])
				assert.deepEqual(range({ serviceLogo: {} }), [`${where} image "serviceLogo": needs a width or maxBytes`])
				assert.deepEqual(range({ serviceLogo: { width: 16, depth: 8 } }), [`${where} image "serviceLogo": unknown property "depth"`])
				for (const value of [0, -1, 1.5, "16"])
					assert.deepEqual(range({ serviceLogo: { width: value } }), [`${where} image "serviceLogo": width must be a positive whole number`], String(value))
				assert.deepEqual(range({ serviceLogo: { width: 16, maxBytes: 0 } }), [`${where} image "serviceLogo": maxBytes must be a positive whole number`])
			})
			test("the rules", () => {
				const range = (rules: unknown) => problems(market([{ from: "r8", to: "r8", rules }]))
				const [m] = parseMarkets(JSON.stringify(market([{ from: "r0", to: "r8", rules: { serviceLogoRequired: true } }, { from: "r8", to: "r8", rules: { serviceLogoRequired: false } }])), "test.json")
				assert.equal(m.settings(A177Revision.r7).rules.serviceLogoRequired, true)
				assert.equal(m.settings(A177Revision.r8).rules.serviceLogoRequired, false, "a later range turns it off")
				assert.deepEqual(range([]), [`${where} rules must be an object`])
				assert.deepEqual(range({ presentableTextLanguage: true }), [`${where} unknown rule "presentableTextLanguage"`])
				assert.deepEqual(range({ serviceLogoRequired: "yes" }), [`${where} rule "serviceLogoRequired" must be true or false`])
				assert.equal(parseMarkets(JSON.stringify(market([{ from: "r8", to: "r8", rules: { dvbsDirectTuning: true } }])), "test.json")[0].settings(A177Revision.r8).rules.dvbsDirectTuning, true, "dvbsDirectTuning")
			})
			test("the schemas", () => {
				const range = (schemas: unknown) => problems(market([{ from: "r6", to: "r6", schemas }]))
				assert.deepEqual(range({ playlist: "x.xsd" }), [`${where} unknown schema "playlist"`])
				assert.deepEqual(range({ serviceList: "" }), [`${where} schema "serviceList" must be a file name`])
				assert.deepEqual(range([]), [`${where} schemas must be an object`])
				const missing = range({ serviceList: "no-such-schema.xsd" })
				assert.equal(missing.length, 1)
				assert.ok(missing[0].startsWith(`${where} the schema "no-such-schema.xsd" is not in`), missing[0])
			})
			test("every problem is listed", () => {
				assert.equal(problems([{ id: "XX", revisions: [{ from: "r9", to: "r0", parameters: { schedule: { daysBefore: -1 } } }] }]).length, 3)
			})
		})

		test("the severity of a code: its own entry, or else the longest prefix", () => {
			const [m] = parseMarkets(JSON.stringify([{ id: "XX", name: "Test", revisions: [{ from: "r8", to: "r8", severity: { "SI020-*": "warning", "SI020-1-*": "off", "SI020-1-2": "error", "SI0*": "information" } }] }]), "test.json")
			const settings = m.settings(A177Revision.r8)
			assert.equal(marketSeverity(settings, "SI020-1-2"), "error", "its own entry")
			assert.equal(marketSeverity(settings, "SI020-1-3"), "off", "the longest prefix")
			assert.equal(marketSeverity(settings, "SI020-2"), "warning")
			assert.equal(marketSeverity(settings, "SI0201"), "information", "a shorter prefix")
			assert.equal(marketSeverity(settings, "SL264"), undefined)
			assert.equal(marketSeverity(MARKET_DEFAULTS, "SI020-1-2"), undefined)
		})

		describe("the findings of a validation for a market", () => {
			// a market defined for these tests: every finding of SL263 off, SL262 a warning, and SL244 an error (r8 only)
			addMarkets(parseMarkets(JSON.stringify([{ id: "APP-TEST", name: "Test", revisions: [{ from: "r8", to: "r8", severity: { SL263: "off", SL262: "warning", SL244: "error" } }] }]), "test-app"))
			const list = (lcn: string, ns = "2026") => `<?xml version="1.0" encoding="UTF-8"?>
<ServiceList id="tag:dvb.org,2026:app" version="1" xmlns="urn:dvb:metadata:servicediscovery:${ns}" xml:lang="en">
	<StandardVersion>urn:dvb:metadata:dvbi:standardversion:${ns == "2026" ? 8 : 7}</StandardVersion>
	<Name>Market</Name>
	<ProviderName>Regression Test</ProviderName>
	<LCNTableList><LCNTable${ns == "2026" ? ' version="1"' : ""}><SubscriptionPackage>Gold</SubscriptionPackage>${lcn}</LCNTable></LCNTableList>
	<Service version="1">
		<UniqueIdentifier>tag:dvb.org,2026:svc1</UniqueIdentifier>
		<ServiceName>Test</ServiceName>
		<ProviderName>Paul Higgs</ProviderName>
	</Service>
	<SubscriptionPackageList><SubscriptionPackage>Gold</SubscriptionPackage></SubscriptionPackageList>
</ServiceList>`
			const LCNS = '<LCN channelNumber="1" serviceRef="tag:dvb.org,2026:svc1"/><LCN channelNumber="1" serviceRef="tag:dvb.org,2026:svc1"/><LCN channelNumber="2" serviceRef="tag:dvb.org,2026:none"/>'
			const validate = async (market: string | undefined, ns?: string) => {
				const errs = new ErrorList()
				await services.slcheck!.doValidateServiceList(list(LCNS, ns), errs, { market, images: "no", report_schema_version: false })
				return errs
			}
			const codes = (errs: ErrorList) => ({ errors: errs.errors.map((e) => e.code).sort(), warnings: errs.warnings.map((e) => e.code).sort() })
			test("without the market", async () => assert.deepEqual(codes(await validate(undefined)), { errors: ["SL262", "SL263"], warnings: ["SL244"] }))
			test("with the market: changed, turned off and raised, with the code kept", async () => {
				const errs = await validate("APP-TEST")
				assert.deepEqual(codes(errs), { errors: ["SL244"], warnings: ["SL262"] })
				assert.equal(errs.informationals.length, 0)
				assert.ok(errs.warnings[0].message.endsWith("(an error in A177, a warning for the market APP-TEST)"), errs.warnings[0].message)
				assert.ok(errs.errors[0].message.endsWith("(a warning in A177, an error for the market APP-TEST)"), errs.errors[0].message)
				assert.ok(!JSON.stringify(jsonResult(errs, "all")).includes("SL263"), "a finding turned off is not reported at all")
			})
			test("with the market, for a revision it does not change", async () => assert.deepEqual(codes(await validate("APP-TEST", "2025")), { errors: ["SL262", "SL263"], warnings: ["SL244"] }))
			test("suppressed by the market: listed, with its type in A177, but not counted", async () => {
				// an error (SL262) and a warning (SL244) of A177 suppressed, and SL263 kept
				addMarkets(parseMarkets(JSON.stringify([{ id: "APP-SUPP", name: "Suppressing", revisions: [{ from: "r8", to: "r8", severity: { SL262: "suppressed", SL244: "suppressed" } }] }]), "test-app"))
				const errs = await validate("APP-SUPP")
				assert.deepEqual(codes(errs), { errors: ["SL263"], warnings: [] })
				assert.deepEqual(errs.suppressed.map((e) => e.code).sort(), ["SL244", "SL262"])
				assert.ok(errs.suppressed.find((e) => e.code == "SL262")!.message.endsWith("(an error in A177, suppressed for the market APP-SUPP)"))
				assert.ok(errs.suppressed.find((e) => e.code == "SL244")!.message.endsWith("(a warning in A177, suppressed for the market APP-SUPP)"))
				assert.equal(errs.numSuppressed(), 2)
				assert.equal(errs.severity(), 4, "the result is that of the errors it still has")
				const summary = jsonResult(errs, "summary")
				assert.deepEqual([summary.errors, summary.warnings, summary.suppressed], [1, 0, 2])
				assert.deepEqual((jsonResult(errs, "tree").document as { codes: object }).codes, { errors: { SL263: 1 }, suppressed: { SL262: 1, SL244: 1 } })
				// a document whose only findings are suppressed has no result to report, and the summary of a traversed document counts them
				const only = ErrorList.summaryOnly("https://example.invalid/a", "SL", "a")
				{
					using scope = ValidationScope.open({ market: "APP-SUPP" })
					setDocumentRevision(A177Revision.r8)
					only.addError({ type: WARNING, code: "SL244", message: "w" })
					await scope.finish()
				}
				assert.deepEqual([only.severity(), only.numWarnings(), only.codesReported("suppressed")], [0, 0, [["SL244", 1]]])
			})
			test("a finding added outside a validation is not changed", () => {
				const errs = new ErrorList()
				errs.addError({ code: "SL263", message: "outside" })
				assert.equal(errs.errors.length, 1)
			})
		})

		describe("the revisions a market permits", () => {
			const LCN = join(import.meta.dirname, "test-003", "05-LCN tables")
			const list = (revision: string) => readFileSync(join(LCN, `0061${revision} deprecated SubscriptionPackage in LCNTable.xml`), "utf8")
			const validate = async (text: string, market: string | undefined) => {
				const errs = new ErrorList()
				await services.slcheck!.doValidateServiceList(text, errs, { market, images: "no", report_schema_version: false })
				return errs
			}
			test("a revision the market does not permit: only MKT001, and the document is not validated", async () => {
				for (const revision of ["r5", "r7", "r8"]) {
					const errs = await validate(list(revision), "DE")
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT001"], revision)
					assert.equal(errs.warnings.length + errs.informationals.length, 0, revision)
					assert.equal(errs.errors[0].message, `A177${revision} is not permitted for the market DE (permitted: A177r6), so the document is not validated`)
				}
			})
			test("the revision the market permits is validated", async () => {
				// the German testbed document, an A177r6 service list
				const errs = await validate(readFileSync(join(import.meta.dirname, "test-016", "DE", "0001r6 tc-62-DE.xml"), "utf8"), "DE")
				// only the market's rules (#139 IT-6): it has no logos, banners, content guide source, DisplayName or broadcast LCN range
				assert.deepEqual([...new Set(errs.errors.map((e) => e.code))].sort(), ["MKT002", "MKT008", "MKT010", "MKT011", "MKT013"])
			})
			test("without the market, every revision is validated", async () => {
				for (const revision of ["r5", "r7", "r8"]) assert.ok(!(await validate(list(revision), undefined)).errors.some((e) => e.code == "MKT001"), revision)
			})
			test("a namespace that is not known keeps its own error", async () => {
				const errs = await validate(list("r8").replace("urn:dvb:metadata:servicediscovery:2026", "urn:example:unknown"), "DE")
				assert.deepEqual(errs.errors.map((e) => e.code), ["SL010"])
			})
			describe("a content guide document validated on its own", () => {
				const cg = createServices(loadConfig({ ...defaults, nosl: true, nopl: true, noslr: true, noait: true, nocsr: true })).cgcheck!
				const DPI = (revision: string) => readFileSync(join(import.meta.dirname, "test-004", `0001${revision} DPI.xml`), "utf8")
				const codes = async (revision: string, market: string | undefined) => {
					const errs = new ErrorList()
					await cg.doValidateContentGuide(DPI(revision), "ProgInfo", errs, { market, images: "no", report_schema_version: false })
					return errs.errors.map((e) => e.code)
				}
				test("TV-Anytime 2024, which A177r6 uses, is validated", async () => assert.ok(!(await codes("r7", "DE")).includes("MKT001")))
				test("TV-Anytime 2027, which no permitted revision uses, is not", async () => assert.deepEqual(await codes("r8", "DE"), ["MKT001"]))
				test("without the market it is validated", async () => assert.ok(!(await codes("r8", undefined)).includes("MKT001")))
			})
		})

		describe("the images of a market", () => {
			// a market defined for these tests: a service logo exactly 16 pixels wide and at most the size of the image below
			const png = (width: number, height: number) => {
				const crc = (bytes: Buffer) => {
					let c = ~0
					for (const b of bytes) {
						c ^= b
						for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
					}
					return ~c >>> 0
				}
				const chunk = (kind: string, data: Buffer) => {
					const body = Buffer.concat([Buffer.from(kind, "latin1"), data])
					const out = Buffer.alloc(12 + data.length)
					out.writeUInt32BE(data.length, 0)
					body.copy(out, 4)
					out.writeUInt32BE(crc(body), 8 + data.length)
					return out
				}
				const header = Buffer.alloc(13)
				header.writeUInt32BE(width, 0)
				header.writeUInt32BE(height, 4)
				header.set([8, 6, 0, 0, 0], 8)
				const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x80)])))
				return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
			}
			const image = png(16, 9)
			addMarkets(parseMarkets(JSON.stringify([{ id: "APP-IMG", name: "Test", revisions: [{ from: "r8", to: "r8", images: { serviceLogo: { width: 16, maxBytes: image.length } } }] }]), "test-app"))
			const list = (logo: Buffer) => `<?xml version="1.0" encoding="UTF-8"?>
<ServiceList id="tag:dvb.org,2026:app-img" version="1" xmlns="urn:dvb:metadata:servicediscovery:2026" xmlns:tva="urn:tva:metadata:2027" xml:lang="en">
	<StandardVersion>urn:dvb:metadata:dvbi:standardversion:8</StandardVersion>
	<Name>Images</Name>
	<ProviderName>Regression Test</ProviderName>
	<Service version="1">
		<UniqueIdentifier>tag:dvb.org,2026:app-img-svc1</UniqueIdentifier>
		<ServiceName>Test</ServiceName>
		<ProviderName>Paul Higgs</ProviderName>
		<RelatedMaterial>
			<tva:HowRelated href="urn:dvb:metadata:cs:HowRelatedCS:2021:1001.2"/>
			<tva:MediaLocator><tva:MediaUri contentType="image/png">data:image/png;base64,${logo.toString("base64")}</tva:MediaUri></tva:MediaLocator>
		</RelatedMaterial>
	</Service>
</ServiceList>`
			const validate = async (logo: Buffer, images: "yes" | "no" = "yes", market: string | null = "APP-IMG") => {
				const errs = new ErrorList()
				configureFetchPolicy({ checkImages: true })
				try {
					await services.slcheck!.doValidateServiceList(list(logo), errs, { market: market ?? undefined, images, report_schema_version: false })
				} finally {
					configureFetchPolicy({ checkImages: false })
				}
				return [...errs.errors, ...errs.warnings].map((e) => `${e.code}${e.type == WARNING ? " (W)" : ""}`)
			}
			test("the width and the file size of the market", async () => assert.deepEqual(await validate(image), []))
			test("one byte more than maxBytes is a warning", async () => {
				// the same image, with a byte after its end (a PNG decoder ignores it)
				assert.deepEqual(await validate(Buffer.concat([image, Buffer.from([0])])), ["IMG021 (W)"])
			})
			test("a width one pixel either side", async () => {
				assert.deepEqual(await validate(png(15, 9)), ["IMG020"])
				assert.deepEqual(await validate(png(17, 9)).then((c) => c.filter((x) => x.startsWith("IMG020"))), ["IMG020"])
			})
			test("not checked without image checks, or without the market", async () => {
				assert.deepEqual(await validate(png(15, 9), "no"), [])
				assert.deepEqual(await validate(png(15, 9), "yes", null), [])
			})
		})

		// the German market's checks of dvb-i-tools #139, on a German A177r6 list (test-002/SAT-IPr6.xml, which has no findings
		// without a market)
		describe("the German market", () => {
			const SATIP = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr6.xml"), "utf8")
			// what the market requires of every service (#139 IT-6), as inline images before the <ServiceType>, where A177r6 puts
			// the RelatedMaterial of a Service: a service logo 320 pixels wide (DE-2) and an out-of-service banner
			const image = (term: string, png: Buffer) =>
				`<RelatedMaterial><tva:HowRelated href="urn:dvb:metadata:cs:HowRelatedCS:2021:${term}"/><tva:MediaLocator><tva:MediaUri contentType="image/png">data:image/png;base64,${png.toString("base64")}</tva:MediaUri></tva:MediaLocator></RelatedMaterial>`
			const LOGO = image("1001.2", testPNG(320, 180)),
				BANNER = image("1000.1", testPNG(1280, 720))
			// and a content guide source, the default of the ServiceList, before its first <Service>
			const CG_SOURCE = '<ContentGuideSource CGSID="cgs1"><ProviderName>ARD</ProviderName><ScheduleInfoEndpoint contentType="application/xml"><dvbi-types:URI>https://cg.example.com/schedule</dvbi-types:URI></ScheduleInfoEndpoint></ContentGuideSource>'
			// and an LCN range for broadcast services in each LCN table, after its LCNs
			const RANGE = '<LCNRange start="100" end="199" serviceOrigin="targetBroadcast"/>'
			const requirements = (text: string, logo = true) =>
				text
					.replace('\t<Service version="1">', `\t${CG_SOURCE}\n\t<Service version="1">`)
					.replace(/<ServiceType /, `${logo ? LOGO : ""}${BANNER}<ServiceType `)
					.replaceAll("</LCNTable>", `${RANGE}</LCNTable>`)
			const FULL = requirements(SATIP)
			// with the direct tuning parameters complete
			const TUNED = FULL.replaceAll("</Polarization>", "</Polarization>\n\t\t\t\t<SymbolRate>27500</SymbolRate>")
			// (null for no market: undefined would give the default)
			const validate = async (text: string, market: string | null = "DE", images: "yes" | "no" = "no") => {
				const errs = new ErrorList()
				configureFetchPolicy({ checkImages: images == "yes" })
				try {
					await services.slcheck!.doValidateServiceList(text, errs, { market: market ?? undefined, images, report_schema_version: false })
				} finally {
					configureFetchPolicy({ checkImages: false })
				}
				return errs
			}
			const codes = async (text: string, market: string | null = "DE", images: "yes" | "no" = "no") => {
				const errs = await validate(text, market, images)
				return [...errs.errors.map((e) => e.code), ...errs.warnings.map((e) => `${e.code} (W)`)].sort()
			}
			test("the settings of DE", () => {
				const settings = findMarket("DE")!.settings(A177Revision.r6)
				assert.deepEqual(settings.images, { serviceLogo: { width: 320, maxBytes: 64000 }, promotionalStillImage: { width: 640, maxBytes: 100000 } })
				assert.deepEqual(settings.parameters.postcode, { digits: 5 })
				assert.deepEqual(settings.parameters.schedule, { daysBefore: 7, daysAfter: 7 })
				assert.deepEqual(settings.parameters.icecast, { contentTypes: ["audio/mpeg", "audio/aac"] })
				assert.deepEqual(settings.severity, { AIT006a: "suppressed", SL202: "error" }, "the days ahead are needed (DE-1)")
				assert.deepEqual(settings.rules, {
					dvbsDirectTuning: true,
					hbbtvInControl: true,
					serviceLogoRequired: true,
					outOfServiceBannerRequired: true,
					serviceTypeRequired: true,
					displayNameRequired: true,
					contentGuideSourceRequired: true,
					serviceInstanceRequired: true,
					broadcastLCNRangeRequired: true,
				})
			})
			test("the base document has no findings for the market", async () => {
				assert.deepEqual(await codes(TUNED), [])
				assert.deepEqual(await codes(TUNED, "DE", "yes"), [], "with the images checked")
				assert.deepEqual(await codes(TUNED, null), [], "without the market")
			})
			// the rules for each Service and ServiceInstance, from the provider column of the IT-6 table (#139)
			describe("what every service has (IT-6)", () => {
				const marketCodes = async (text: string, market: string | null = "DE") => (await codes(text, market)).filter((c) => c.startsWith("MKT"))
				const SERVICE_ID = "tag:daserste.de,2019:DasErste"
				test("a service logo (MKT002)", async () => {
					const errs = await validate(TUNED.replace(LOGO, ""))
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT002"])
					assert.equal(errs.errors[0].message, `service "${SERVICE_ID}" has no service logo in its <Service>, which the market DE requires`)
				})
				test("a service logo only in a service instance does not count", async () =>
					assert.deepEqual(await marketCodes(TUNED.replace(LOGO, "").replace("<DisplayName>Das Erste HD</DisplayName>", `<DisplayName>Das Erste HD</DisplayName>${LOGO}`)), ["MKT002"]))
				test("an out-of-service banner (MKT008)", async () => {
					const errs = await validate(TUNED.replace(BANNER, ""))
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT008"])
					assert.equal(errs.errors[0].message, `service "${SERVICE_ID}" has no out-of-service banner in its <Service>, which the market DE requires`)
				})
				test("another kind of banner does not count", async () =>
					assert.deepEqual(await marketCodes(TUNED.replace(BANNER, image("1001.3", testPNG(1280, 720)))), ["MKT008"]))
				test("a ServiceType (MKT009)", async () => {
					const errs = await validate(TUNED.replace(/[ \t]*<ServiceType [^>]*\/>\r?\n?/, ""))
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT009"])
					assert.equal(errs.errors[0].message, `service "${SERVICE_ID}" has no <ServiceType>, which the market DE requires`)
				})
				test("a DisplayName in every service instance (MKT010)", async () => {
					const errs = await validate(TUNED.replace("<DisplayName>Das Erste HD</DisplayName>", ""))
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT010"])
					assert.equal(errs.errors[0].message, `a <ServiceInstance> (priority 1) of service "${SERVICE_ID}" has no <DisplayName>, which the market DE requires`)
					assert.deepEqual(await marketCodes(TUNED.replaceAll(/<DisplayName>[^<]*<\/DisplayName>/g, "")), ["MKT010", "MKT010", "MKT010"], "once for each instance")
				})
				describe("a content guide source (MKT011)", () => {
					const NO_DEFAULT = TUNED.replace(`\t${CG_SOURCE}\n`, "")
					test("the default of the service list", async () => assert.deepEqual(await marketCodes(TUNED), []))
					test("none", async () => {
						const errs = await validate(NO_DEFAULT)
						assert.deepEqual(errs.errors.map((e) => e.code), ["MKT011"])
						assert.equal(errs.errors[0].message, `service "${SERVICE_ID}" has no content guide source (<ContentGuideSource> or <ContentGuideSourceRef>, or a default in the <ServiceList>), which the market DE requires`)
					})
					test("the service's own ContentGuideSource", async () =>
						assert.deepEqual(await marketCodes(NO_DEFAULT.replace(/(<ServiceType [^>]*\/>)/, `$1${CG_SOURCE}`)), []))
					test("a ContentGuideSourceRef", async () => {
						const withList = NO_DEFAULT.replace('\t<Service version="1">', `\t<ContentGuideSourceList>${CG_SOURCE}</ContentGuideSourceList>\n\t<Service version="1">`)
						assert.deepEqual(await marketCodes(withList.replace(/(<ServiceType [^>]*\/>)/, "$1<ContentGuideSourceRef>cgs1</ContentGuideSourceRef>")), [])
					})
				})
				test("a ServiceInstance (MKT012)", async () => {
					const errs = await validate(TUNED.replaceAll(/[ \t]*<ServiceInstance[ >][\s\S]*?<\/ServiceInstance>\r?\n?/g, ""))
					assert.deepEqual(errs.errors.filter((e) => e.code.startsWith("MKT")).map((e) => e.code), ["MKT012"])
					assert.equal(errs.errors.find((e) => e.code == "MKT012")!.message, `service "${SERVICE_ID}" has no <ServiceInstance>, which the market DE requires`)
				})
				test("all of them missing", async () => {
					const bare = SATIP.replace(/[ \t]*<ServiceType [^>]*\/>\r?\n?/, "").replaceAll(/[ \t]*<ServiceInstance[ >][\s\S]*?<\/ServiceInstance>\r?\n?/g, "")
					assert.deepEqual(await marketCodes(bare), ["MKT002", "MKT008", "MKT009", "MKT011", "MKT012", "MKT013", "MKT013"])
				})
				describe("an LCN range for broadcast services in every LCN table (MKT013)", () => {
					const withRanges = (...ranges: string[]) => TUNED.replaceAll(RANGE, ranges.join(""))
					const range = (origin?: string) => `<LCNRange start="100" end="199"${origin ? ` serviceOrigin="${origin}"` : ""}/>`
					test("legitimate: targetBroadcast, otherBroadcast and any", async () => {
						assert.deepEqual(await marketCodes(withRanges(range("targetBroadcast"))), [])
						assert.deepEqual(await marketCodes(withRanges(range("otherBroadcast"))), [])
						assert.deepEqual(await marketCodes(withRanges(range("any"))), [], "any is for broadcast services as well as DVB-I")
					})
					test("legitimate: a broadcast range with others", async () =>
						assert.deepEqual(await marketCodes(withRanges(range("dvbi"), '<LCNRange start="200" end="299" serviceOrigin="otherBroadcast"/>')), []))
					test("invalid: no LCNRange", async () => {
						const errs = await validate(withRanges())
						assert.deepEqual(errs.errors.map((e) => e.code), ["MKT013", "MKT013"], "each of the two tables")
						assert.equal(errs.errors[0].message, 'the <LCNTable> for "Deutschland" has no <LCNRange> with @serviceOrigin "targetBroadcast", "otherBroadcast" or "any", which the market DE requires')
						assert.ok(errs.errors[1].message.startsWith('the <LCNTable> for "Saarland" '), errs.errors[1].message)
					})
					for (const origin of [undefined, "dvbi", "otherIP"])
						test(`invalid: only an LCNRange with ${origin ? `serviceOrigin ${origin}` : "no serviceOrigin (dvbi)"}`, async () =>
							assert.deepEqual(await marketCodes(withRanges(range(origin))), ["MKT013", "MKT013"]))
					test("only the table without one is reported", async () => {
						const second = TUNED.lastIndexOf(RANGE)
						const errs = await validate(TUNED.slice(0, second) + TUNED.slice(second + RANGE.length))
						assert.deepEqual(errs.errors.map((e) => e.code), ["MKT013"])
						assert.ok(errs.errors[0].message.includes('"Saarland"'), errs.errors[0].message)
					})
					test("not required without the market", async () => assert.deepEqual(await marketCodes(withRanges(), null), []))
				})
				test("without the market, none of them is required", async () => {
					const bare = SATIP.replace(/[ \t]*<ServiceType [^>]*\/>\r?\n?/, "").replaceAll(/<DisplayName>[^<]*<\/DisplayName>/g, "")
					assert.deepEqual(await marketCodes(bare, null), [])
				})
			})
			// the third service instance, with Icecast delivery instead of DASH (A177r8 annex K)
			const DASH = TUNED.slice(TUNED.indexOf("\t\t\t<DASHDeliveryParameters>"), TUNED.indexOf("</DASHDeliveryParameters>") + "</DASHDeliveryParameters>".length)
			const ICECAST_URL = "urn:dvb:icecast:v1:https%3A%2F%2Fstream.example.com%2Fradio.mp3"
			const withIcecast = (attributes: string, identifier = ICECAST_URL) => TUNED.replace(DASH, `\t\t\t<IdentifierBasedDeliveryParameters${attributes}>${identifier}</IdentifierBasedDeliveryParameters>`)
			describe("Icecast media types (DE-6)", () => {
				const icecastCodes = async (text: string, market: string | null = "DE") => (await codes(text, market)).filter((c) => c.startsWith("MKT"))
				test("the document has a place for Icecast delivery", () => assert.ok(DASH.length > 0 && withIcecast("") != TUNED))
				test("legitimate: audio/mpeg and audio/aac", async () => {
					assert.deepEqual(await icecastCodes(withIcecast(' contentType="audio/mpeg"')), [])
					assert.deepEqual(await icecastCodes(withIcecast(' contentType="audio/aac"')), [])
				})
				test("boundary: the media type in capitals", async () => assert.deepEqual(await icecastCodes(withIcecast(' contentType="Audio/AAC"')), []))
				test("invalid: another media type", async () => {
					const errs = await validate(withIcecast(' contentType="audio/ogg"'))
					const found = errs.errors.filter((e) => e.code == "MKT005")
					assert.equal(found.length, 1)
					assert.equal(found[0].message, 'the Icecast <IdentifierBasedDeliveryParameters> has @contentType "audio/ogg", but the market DE requires "audio/mpeg" or "audio/aac"')
				})
				test("invalid: no media type", async () => {
					const errs = await validate(withIcecast(""))
					const found = errs.errors.filter((e) => e.code == "MKT005")
					assert.equal(found.length, 1)
					assert.equal(found[0].message, 'the Icecast <IdentifierBasedDeliveryParameters> has no @contentType, which the market DE requires to be "audio/mpeg" or "audio/aac"')
				})
				test("an identifier that is not Icecast is not checked", async () =>
					assert.deepEqual(await icecastCodes(withIcecast(' contentType="audio/ogg"', "urn:example:stream:1")), []))
				test("without the market, any media type", async () => assert.deepEqual(await icecastCodes(withIcecast(' contentType="audio/ogg"'), null), []))
			})
			describe("an HbbTV application for a linked application that controls the presentation (DE-8)", () => {
				// a service with the AIT checker, which the markets' services do not have
				const withAITs = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }))
				const AIT = "application/vnd.dvb.ait+xml"
				const aitOf = (...types: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<mhp:ServiceDiscovery xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:mhp="urn:dvb:mhp:2026">
	<mhp:ApplicationDiscovery DomainName="example.com">
		<mhp:ApplicationList>${types.map((type, i) => `
			<mhp:Application>
				<mhp:appName Language="eng">Test application</mhp:appName>
				<mhp:applicationIdentifier><mhp:orgId>123</mhp:orgId><mhp:appId>${456 + i}</mhp:appId></mhp:applicationIdentifier>
				<mhp:applicationDescriptor>
					<mhp:type><mhp:OtherApp>${type}</mhp:OtherApp></mhp:type>
					<mhp:controlCode>AUTOSTART</mhp:controlCode>
					<mhp:visibility>VISIBLE_ALL</mhp:visibility>
					<mhp:serviceBound>false</mhp:serviceBound>
					<mhp:priority>${i + 1}</mhp:priority>
					<mhp:version>01</mhp:version>
					<mhp:mhpVersion><mhp:profile>0</mhp:profile><mhp:versionMajor>1</mhp:versionMajor><mhp:versionMinor>8</mhp:versionMinor><mhp:versionMicro>1</mhp:versionMicro></mhp:mhpVersion>
				</mhp:applicationDescriptor>
				<mhp:applicationTransport xsi:type="mhp:HTTPTransportType"><mhp:URLBase>https://www.example.com/</mhp:URLBase></mhp:applicationTransport>
				<mhp:applicationLocation>app.html</mhp:applicationLocation>
			</mhp:Application>`).join("")}
		</mhp:ApplicationList>
	</mhp:ApplicationDiscovery>
</mhp:ServiceDiscovery>`
				const AITS: Record<string, string> = {
					"/hbbtv.aitx": aitOf("application/vnd.hbbtv.xhtml+xml"),
					"/html5-and-hbbtv.aitx": aitOf("text/html", "application/vnd.hbbtv.xhtml+xml"),
					"/html5.aitx": aitOf("text/html"),
				}
				let server: Server, base = ""
				before(async () => {
					configureFetchPolicy({ allowPrivateAddresses: true })
					server = createServer((req, res) => {
						const body = AITS[req.url ?? ""]
						if (!body) {
							res.statusCode = 404
							return res.end()
						}
						res.writeHead(200, { "Content-Type": AIT })
						res.end(body)
					})
					await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
					base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
				})
				after(() => {
					server.close()
					configureFetchPolicy({ allowPrivateAddresses: false })
				})
				// a linked application in the first service instance, after its DisplayName (where A177r6 puts its RelatedMaterial)
				const withApp = (path: string, contentType: string | null = AIT, type = "1.2") =>
					TUNED.replace(
						"<DisplayName>Das Erste HD</DisplayName>",
						`<DisplayName>Das Erste HD</DisplayName>\n\t\t\t<RelatedMaterial><tva:HowRelated href="urn:dvb:metadata:cs:LinkedApplicationCS:2019:${type}"/><tva:MediaLocator><tva:MediaUri${contentType ? ` contentType="${contentType}"` : ""}>${base}${path}</tva:MediaUri></tva:MediaLocator></RelatedMaterial>`
					)
				// the MKT codes of the service list, and of the AITs it refers to
				const appCodes = async (text: string, market: string | null = "DE", aits = true) => {
					const errs = new ErrorList()
					await withAITs.slcheck!.doValidateServiceList(text, errs, { market: market ?? undefined, aits, images: "no", report_schema_version: false })
					const own = errs.errors.map((e) => e.code)
					const nested = errs.nestedErrors.flatMap((n) => n.codesReported("errors").map(([code]) => `${code} (AIT)`))
					return { codes: [...own, ...nested].filter((c) => c.startsWith("MKT")).sort(), errs }
				}
				test("the document has a place for a linked application", () => assert.notEqual(withApp("/hbbtv.aitx"), TUNED))
				test("legitimate: an XML AIT with an HbbTV application", async () => assert.deepEqual((await appCodes(withApp("/hbbtv.aitx"))).codes, []))
				test("legitimate: an HbbTV application and another", async () => assert.deepEqual((await appCodes(withApp("/html5-and-hbbtv.aitx"))).codes, []))
				test("invalid: an XML AIT without an HbbTV application", async () => {
					const { codes, errs } = await appCodes(withApp("/html5.aitx"))
					assert.deepEqual(codes, ["MKT007 (AIT)"])
					const nested = errs.nestedErrors.find((n) => n.codesReported("errors").some(([code]) => code == "MKT007"))
					assert.ok(nested, "reported in the results of the AIT")
				})
				test("invalid: a linked application that is not an XML AIT", async () => {
					const { codes, errs } = await appCodes(withApp("/app.html", "text/html"))
					assert.deepEqual(codes, ["MKT006"])
					assert.equal(errs.errors.find((e) => e.code == "MKT006")!.message, `the linked application "urn:dvb:metadata:cs:LinkedApplicationCS:2019:1.2" is of type "text/html", but the market DE requires an XML AIT ("${AIT}")`)
				})
				test("invalid: a linked application without a media type", async () => assert.deepEqual((await appCodes(withApp("/hbbtv.aitx", null))).codes, ["MKT006"]))
				test("the AIT is only checked when the AITs are", async () => assert.deepEqual((await appCodes(withApp("/html5.aitx"), "DE", false)).codes, []))
				test("other linked applications are not checked", async () => {
					assert.deepEqual((await appCodes(withApp("/html5.aitx", AIT, "1.1"))).codes, [], "an application in parallel")
					assert.deepEqual((await appCodes(withApp("/app.html", "text/html", "1.1"))).codes, [])
				})
				test("without the market there are no findings", async () => {
					assert.deepEqual((await appCodes(withApp("/html5.aitx"), null)).codes, [])
					assert.deepEqual((await appCodes(withApp("/app.html", "text/html"), null)).codes, [])
				})
			})
			describe("DVB-S direct tuning (DE-15)", () => {
				test("without the market there are no findings", async () => assert.deepEqual(await codes(FULL, null), []))
				test("a DVB-S service instance without SymbolRate", async () => {
					const errs = await validate(FULL)
					assert.deepEqual(errs.errors.map((e) => e.code), ["MKT004", "MKT004"])
					assert.equal(errs.errors[0].message, "<DVBSDeliveryParameters> has no <SymbolRate>, which the market DE requires for direct tuning")
				})
				test("with all of OrbitalPosition, Frequency, Polarization and SymbolRate", async () => assert.deepEqual(await codes(TUNED), []))
				test("without several", async () => {
					const errs = await validate(FULL.replace(/[ \t]*<OrbitalPosition>19\.2<\/OrbitalPosition>\r?\n/, ""))
					assert.ok(errs.errors.some((e) => e.message.startsWith("<DVBSDeliveryParameters> has no <OrbitalPosition>, <SymbolRate>")), JSON.stringify(errs.errors.map((e) => e.message)))
				})
			})
			describe("postcodes of 5 digits (DE-18)", () => {
				const withPostcode = (element: string) => TUNED.replace("<Postcode>66265</Postcode>", element)
				const postcodeCodes = async (element: string) => (await codes(withPostcode(element))).filter((c) => c.startsWith("MKT003"))
				for (const element of [
					"<Postcode>86150</Postcode>",
					"<Postcode>00000</Postcode>",
					"<Postcode>99999</Postcode>",
					'<PostcodeRange from="86150" to="86199"/>',
					'<PostcodeRange from="86150" to="86150"/>',
					"<WildcardPostcode>86*</WildcardPostcode>",
					"<WildcardPostcode>8615*</WildcardPostcode>",
					"<WildcardPostcode>8*150</WildcardPostcode>",
					"<WildcardPostcode>*6150</WildcardPostcode>",
				])
					test(`legitimate: ${element}`, async () => assert.deepEqual(await postcodeCodes(element), []))
				for (const element of [
					"<Postcode>8615</Postcode>",
					"<Postcode>861500</Postcode>",
					"<Postcode>8615A</Postcode>",
					"<Postcode>86 150</Postcode>",
					'<PostcodeRange from="8615" to="86199"/>',
					'<PostcodeRange from="86199" to="86150"/>',
					"<WildcardPostcode>86150*</WildcardPostcode>",
					"<WildcardPostcode>8*1500</WildcardPostcode>",
				])
					test(`invalid: ${element}`, async () => assert.deepEqual(await postcodeCodes(element), ["MKT003"]))
				test("without the market, any postcode A177 allows", async () =>
					assert.deepEqual((await codes(withPostcode("<Postcode>8615A</Postcode>"), null)).filter((c) => c.startsWith("MKT")), []))
			})
			describe("service logos of 320 pixels and at most 64000 bytes (DE-2)", () => {
				// in place of the base document's logo
				const withLogo = (logo: Buffer) => TUNED.replace(LOGO, image("1001.2", logo))
				test("the document has a place for a logo", () => assert.notEqual(withLogo(testPNG(1, 1)), TUNED))
				test("320 pixels wide, of any height", async () => {
					assert.deepEqual(await codes(withLogo(testPNG(320, 180)), "DE", "yes"), [])
					assert.deepEqual(await codes(withLogo(testPNG(320, 320)), "DE", "yes"), [])
				})
				test("319 and 321 pixels wide", async () => {
					assert.deepEqual(await codes(withLogo(testPNG(319, 180)), "DE", "yes"), ["IMG020"])
					assert.deepEqual(await codes(withLogo(testPNG(321, 180)), "DE", "yes"), ["IMG020"])
				})
				test("larger than 64000 bytes", async () => {
					const large = testPNG(320, 60, true)
					assert.ok(large.length > 64000, String(large.length))
					assert.deepEqual(await codes(withLogo(large), "DE", "yes"), ["IMG021 (W)"])
				})
				test("not checked without the market", async () => assert.deepEqual(await codes(withLogo(testPNG(319, 180)), null, "yes"), []))
			})
		})

		// the market of a validation in its results (phase 4)
		describe("the market in the results", () => {
			const SL = readFileSync(join(import.meta.dirname, "test-016", "DE", "0001r6 tc-62-DE.xml"), "utf8")
			const post = (path: string, headers: Record<string, string> = {}) =>
				fetch(`${base}${path}`, { method: "POST", body: SL, headers: { "Content-Type": "application/xml", "X-images": "no", ...headers } })
			test("the JSON summary names the market", async () => {
				assert.deepEqual((await (await post("/validate_sl_json", { "X-market": "de" })).json()).market, { id: "DE", name: "Germany" })
				assert.equal((await (await post("/validate_sl_json")).json()).market, undefined, "none without a market")
			})
			test("the HTML results name the market", async () => {
				assert.ok((await (await post("/validate_sl", { "X-market": "DE" })).text()).includes("for the market Germany (DE)"))
				assert.ok(!(await (await post("/validate_sl")).text()).includes("for the market"))
			})
			test("the ErrorList of a direct validation", async () => {
				const errs = new ErrorList()
				await services.slcheck!.doValidateServiceList(SL, errs, { market: "DE", images: "no" })
				assert.deepEqual(errs.market, { id: "DE", name: "Germany" })
				assert.deepEqual((jsonResult(errs, "all") as { errs: { market: unknown } }).errs.market, { id: "DE", name: "Germany" }, "results=all")
			})
		})

		describe("a validation for a market", () => {
			const folder = join(import.meta.dirname, "test-016", "DE")
			const SL = readFileSync(join(folder, readdirSync(folder).filter((f) => f.endsWith(".xml")).sort()[0]), "utf8")
			const post = (headers: Record<string, string>) =>
				fetch(`${base}/validate_sl_json`, { method: "POST", body: SL, headers: { "Content-Type": "application/xml", "X-images": "no", ...headers } })
			test("an undefined market is answered with 400", async () => {
				for (const headers of [{ "X-market": "XX" }, { "X-variants": "XX" }] as Record<string, string>[]) {
					const response = await post(headers)
					assert.equal(response.status, 400, JSON.stringify(headers))
					const { parseErr } = await response.json()
					assert.equal(parseErr.length, 1)
					assert.ok(parseErr[0].startsWith('the market "XX" is not defined: the markets are "DE"'), parseErr[0])
				}
				const page = await fetch(`${base}/validate_sl?url=https://example.invalid/sl.xml&market=XX`)
				assert.equal(page.status, 400, "a GET, and the HTML results")
				assert.ok((await page.text()).includes("is not defined"))
			})
			test("a market that is defined, in any case, the deprecated variants, and none", async () => {
				for (const headers of [{ "X-market": "DE" }, { "X-market": "de" }, { "X-variants": "DE" }, { "X-market": "" }, {}] as Record<string, string>[])
					assert.equal((await post(headers)).status, 200, JSON.stringify(headers))
			})
			test("market wins over variants", async () => assert.equal((await post({ "X-market": "DE", "X-variants": "XX" })).status, 200))
			test("a direct validation for a market that is not defined", async () => {
				await assert.rejects(services.slcheck!.doValidateServiceList(SL, new ErrorList(), { market: "XX", images: "no" }), /the market "XX" is not defined/)
			})
			test("the /check form offers the markets", async () => {
				const page = await (await fetch(`${base}/check`)).text()
				assert.ok(page.includes('name="market" value="" id="marketNone" checked'), "none, by default")
				assert.ok(page.includes('name="market" value="DE" id="marketDE"'), "the German market")
				const body = new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: "https://example.invalid/sl.xml", images: "no", market: "XX" })
				const result = await (await fetch(`${base}/check`, { method: "POST", body })).text()
				assert.ok(result.includes("the market &quot;XX&quot; is not defined"), "a market that is not defined")
			})
		})
	})

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
			const SHARED = ["countsFatal", "countsErr", "countsWarn", "countsInfo", "fatals", "errors", "warnings", "informationals", "suppressed", "errorDescriptions"] as const
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
				assert.equal(JSON.stringify(json(none).codeCounts), JSON.stringify({ fatals: {}, errors: {}, warnings: {}, informationals: {}, suppressed: {} }))
				assert.equal(JSON.stringify(json(one).codeCounts), JSON.stringify({ fatals: {}, errors: { VCG002: 1 }, warnings: {}, informationals: {}, suppressed: {} }))
				assert.equal(JSON.stringify(json(more).codeCounts), JSON.stringify({ fatals: {}, errors: { VCG002: 2 }, warnings: {}, informationals: { I1: 1 }, suppressed: {} }))
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
			const coverage = () => new ScheduleCoverage("sid", DAY0 + DAY, 1, 1)
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
				const result = new ScheduleCoverage("sid", DAY0, 28, 28).evaluate()
				assert.equal(result.days.length, 57)
				assert.equal(result.days[28].date, "2026-11-10")
				assert.equal(result.days[28].offset, 0, "today")
				assert.equal(result.days[0].offset, -28)
				assert.equal(result.days[56].offset, 28)
				assert.equal(result.daysBefore, 28)
				assert.equal(result.daysAfter, 28)
			})
			test("different numbers of days before and after today (#139 DE-1)", () => {
				const result = new ScheduleCoverage("sid", DAY0, 2, 5).evaluate()
				assert.deepEqual(result.days.map((d) => d.offset), [-2, -1, 0, 1, 2, 3, 4, 5])
				assert.equal(result.days[0].date, "2026-11-08")
				assert.equal(result.days[7].date, "2026-11-15")
				assert.deepEqual([result.daysBefore, result.daysAfter], [2, 5])
			})
			test("no days before or after: only today", () => {
				const result = new ScheduleCoverage("sid", DAY0, 0, 0).evaluate()
				assert.deepEqual(result.days.map((d) => [d.date, d.offset]), [["2026-11-10", 0]])
			})
		})

		// a market for these tests, with 7 days of schedule for every revision (the German market permits only A177r6)
		// SHORT has 2 days before and 5 after, and WEEK-AHEAD needs the days ahead as the German market does (SL202 an error, #139 DE-1)
		addMarkets(
			parseMarkets(
				JSON.stringify([
					{ id: "WEEK", name: "7 days", revisions: [{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 7, daysAfter: 7 } } }] },
					{ id: "SHORT", name: "2 days back, 5 ahead", revisions: [{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 2, daysAfter: 5 } } }] },
					{ id: "WEEK-AHEAD", name: "7 days, needed ahead", revisions: [{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 7, daysAfter: 7 } }, severity: { SL202: "error" } }] },
					{ id: "NEAR", name: "1 day back, 2 ahead", revisions: [{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 1, daysAfter: 2 } } }] },
					{ id: "TODAY", name: "today only", revisions: [{ from: "r0", to: "latest", parameters: { schedule: { daysBefore: 0, daysAfter: 0 } } }] },
				]),
				"test-app"
			)
		)
		// a service list with one service, whose schedules come from a local server. The market WEEK asks for 7 days either
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
			const validate = async (maxTraversal: number, market: string = "WEEK") => {
				const errs = ErrorList.withMarkup()
				requested = []
				await services.slcheck!.doValidateServiceList(slText, errs, { traverse: true, maxTraversal, images: "no", market })
				return errs
			}
			const day = (n: number) => new Date(first + n * DAY).toISOString().slice(0, 10)
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
			test("a warning for the days before today, with the dates (SL201)", async () => {
				const errs = await validate(Infinity)
				const warnings = errs.warnings.filter((w) => w.code == "SL201")
				assert.equal(warnings.length, 1)
				assert.ok(warnings[0].message.includes("does not cover every day before today: of the 7 days from 7 days before today to yesterday, 5 fully covered, 1 partly, 1 not at all."), warnings[0].message)
				assert.ok(warnings[0].message.endsWith(`Not covered: ${day(3)}. Partly covered: ${day(5)}`), warnings[0].message)
			})
			test("a warning for today and the days after, with the dates (SL202)", async () => {
				const errs = await validate(Infinity)
				const warnings = errs.warnings.filter((w) => w.code == "SL202")
				assert.equal(warnings.length, 1)
				assert.ok(warnings[0].message.includes("does not cover every day from today: of the 8 days from today to 7 days after today, 6 fully covered, 1 partly, 1 not at all."), warnings[0].message)
				assert.ok(warnings[0].message.endsWith(`Not covered: ${day(9)}. Partly covered: ${day(11)}`), warnings[0].message)
				assert.equal(errs.errors.filter((e) => e.code.startsWith("SL20")).length, 0, "both are warnings in A177")
			})
			test("a market that needs the days ahead: SL202 is an error, SL201 still a warning (#139 DE-1)", async () => {
				const errs = await validate(Infinity, "WEEK-AHEAD")
				assert.deepEqual(errs.errors.filter((e) => e.code.startsWith("SL20")).map((e) => e.code), ["SL202"])
				assert.deepEqual(errs.warnings.filter((e) => e.code.startsWith("SL20")).map((e) => e.code), ["SL201"])
			})
			test("different numbers of days before and after today (#139 DE-1)", async () => {
				// 2 days before and 5 after: days 5 to 12 of the timeline
				const errs = await validate(Infinity, "SHORT")
				assert.deepEqual(stateOf(errs), EXPECTED.slice(5, 13))
				assert.deepEqual(errs.scheduleCoverage![0].days.map((d) => d.offset), [-2, -1, 0, 1, 2, 3, 4, 5])
				assert.equal(requested.filter((q) => q.includes("start=")).length, 32, "4 windows for each of the 8 days")
				const message = (code: string) => errs.warnings.find((w) => w.code == code)?.message ?? ""
				assert.ok(message("SL201").includes("of the 2 days from 2 days before today to yesterday, 1 fully covered, 1 partly, 0 not at all."), message("SL201"))
				assert.ok(message("SL202").includes("of the 6 days from today to 5 days after today, 4 fully covered, 1 partly, 1 not at all."), message("SL202"))
			})
			test("only the side of today with a gap is reported", async () => {
				// 1 day before (day 6, covered) and 2 after (days 7 and 8 covered, day 9 not)
				const ahead = await validate(Infinity, "NEAR")
				assert.deepEqual(stateOf(ahead), ["full", "full", "full", "none"])
				assert.deepEqual(ahead.warnings.filter((w) => w.code.startsWith("SL20")).map((w) => w.code), ["SL202"])
				assert.ok(ahead.warnings.find((w) => w.code == "SL202")!.message.includes("of the 3 days from today to 2 days after today"))
				// today only (day 7, covered)
				const todayOnly = await validate(Infinity, "TODAY")
				assert.deepEqual(stateOf(todayOnly), ["full"])
				assert.equal(todayOnly.warnings.filter((w) => w.code.startsWith("SL20")).length, 0)
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
				// the days before today were all validated, and today and the days after are all indeterminate
				assert.ok(!errs.warnings.find((w) => w.code == "SL201")!.message.includes("indeterminate"))
				assert.equal(errs.warnings.filter((w) => w.code == "SL202").length, 0)
			})
			test("indeterminate days are counted in the message", async () => {
				// the now/next request and 25 windows: days 0 to 5, and the first window of day 6
				const errs = await validate(26)
				assert.match(errs.warnings.find((w) => w.code == "SL201")!.message, /, and 1 indeterminate because a traversal limit was reached\./)
			})
			test("no warning when every day is covered or indeterminate", async () => {
				// days 0 to 2 are covered, and the rest skipped
				const errs = await validate(13)
				assert.ok(stateOf(errs).slice(0, 3).every((s) => s == "full"))
				assert.ok(stateOf(errs).slice(3).every((s) => s == "indeterminate"))
				assert.equal(errs.warnings.filter((w) => w.code.startsWith("SL20")).length, 0)
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
				await services.slcheck!.doValidateServiceList(slText.replace(service, `${service}\n${second}`), errs, { traverse: true, maxTraversal: Infinity, images: "no", market: "WEEK" })
				assert.equal(errs.scheduleCoverage?.length, 1)
				assert.deepEqual(errs.scheduleCoverage![0].services, ["tag:daserste.de,2019:DasErste", "tag:daserste.de,2019:DasErsteHD"])
				assert.deepEqual(stateOf(errs), EXPECTED)
				assert.equal(requested.filter((q) => q.includes("start=")).length, 60, "the windows are requested once")
				const warnings = errs.warnings.filter((w) => w.code.startsWith("SL20"))
				assert.deepEqual(warnings.map((w) => w.code), ["SL201", "SL202"])
				for (const warning of warnings) assert.ok(warning.message.includes('of services "tag:daserste.de,2019:DasErste", "tag:daserste.de,2019:DasErsteHD"'), warning.message)
			})
			test("the JSON summary and the HTML report", async () => {
				const errs = await validate(Infinity)
				const json = jsonResult(errs, "summary") as { scheduleCoverage: { service: string; counts: unknown }[] }
				assert.equal(json.scheduleCoverage.length, 1)
				assert.deepEqual(json.scheduleCoverage[0].counts, { full: 11, partial: 2, none: 2, indeterminate: 0 })
				// with a POST, the choices are in X- headers
				const headers = { "Content-Type": "application/xml", "X-traverse": "true", "X-max-traversal": "unlimited", "X-market": "WEEK", "X-images": "no" }
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

// the image_variant query parameter (A177r8 clause 5.2.8.2.1, dvb-i-tools #153): a document given by a URL with an
// image_variant is validated with that variant, which is added to every request the validation makes for a service list,
// registry response or content guide, and the images in the responses are checked against it
describe("Image variants", () => {
	describe("the variants and the URLs", () => {
		test("the 13 variants of table 8, with the revision, shape and transparency of each", () => {
			assert.equal(IMAGE_VARIANTS.length, 13)
			assert.deepEqual(IMAGE_VARIANTS.filter((v) => v.since == A177Revision.r8).map((v) => v.value), ["2x3_colour", "2x3_white", "2x3_colour_light", "2x3_colour_dark"], "the 2:3 variants are from A177r8")
			assert.ok(IMAGE_VARIANTS.filter((v) => !v.value.startsWith("2x3")).every((v) => v.since == A177Revision.r3))
			const of = (value: string) => IMAGE_VARIANTS.find((v) => v.value == value)!
			assert.deepEqual([of("16x9_colour").shape, of("square_white").shape, of("4x3_colour").shape, of("2x3_colour_dark").shape], [{ width: 16, height: 9 }, { width: 1, height: 1 }, { width: 4, height: 3 }, { width: 2, height: 3 }])
			assert.deepEqual(IMAGE_VARIANTS.filter((v) => !v.transparent).map((v) => v.value), ["16x9_colour", "square_colour", "4x3_colour", "2x3_colour"], "only the colour variants are not on transparent")
			for (const value of ["16x9_colour", "square_white", "4x3_colour", "16x9_colour_dark"]) assert.ok(isImageVariant(value), value)
			for (const value of ["", "16x9", "16X9_COLOUR", "4x3_white", "16x9_colour "]) assert.ok(!isImageVariant(value), JSON.stringify(value))
		})
		test("withImageVariant() adds the parameter", () => {
			assert.equal(withImageVariant("https://example.com/sl", "16x9_colour"), "https://example.com/sl?image_variant=16x9_colour")
			assert.equal(withImageVariant("https://example.com/s?sid=tag:a,2026:b&now_next=true", "square_white"), "https://example.com/s?sid=tag:a,2026:b&now_next=true&image_variant=square_white")
			assert.equal(withImageVariant("https://example.com/s?", "4x3_colour"), "https://example.com/s?image_variant=4x3_colour")
			assert.equal(withImageVariant("https://example.com/s?a=1&", "4x3_colour"), "https://example.com/s?a=1&image_variant=4x3_colour")
			assert.equal(withImageVariant("https://example.com/s?a=1#top", "4x3_colour"), "https://example.com/s?a=1&image_variant=4x3_colour#top", "before a fragment")
			const url = "https://example.com/gi?groupId=crid://example.com/a%20b&regionID[]=r1"
			assert.equal(withImageVariant(url, "16x9_colour"), `${url}&image_variant=16x9_colour`, "the rest of the URL is kept as it is")
		})
		test("withImageVariant() leaves a URL without a variant, or with one, unchanged", () => {
			assert.equal(withImageVariant("https://example.com/sl", undefined), "https://example.com/sl")
			assert.equal(withImageVariant("https://example.com/sl?image_variant=square_colour", "16x9_colour"), "https://example.com/sl?image_variant=square_colour")
			assert.equal(withImageVariant("https://example.com/sl"), "https://example.com/sl", "outside a validation, there is no variant")
		})
		test("withoutImageVariant() and urlImageVariant()", () => {
			assert.equal(withoutImageVariant("https://example.com/s?a=1&image_variant=16x9_white&b=2"), "https://example.com/s?a=1&b=2")
			assert.equal(withoutImageVariant("https://example.com/s?image_variant=16x9_white"), "https://example.com/s")
			assert.equal(withoutImageVariant("https://example.com/s?a=1&image_variant=x#top"), "https://example.com/s?a=1#top")
			assert.equal(withoutImageVariant("https://example.com/s"), "https://example.com/s")
			assert.equal(urlImageVariant("https://example.com/sl?a=1&image_variant=16x9_white"), "16x9_white")
			assert.equal(urlImageVariant("https://example.com/sl?a=1"), undefined)
			assert.equal(urlImageVariant("not a URL"), undefined)
		})
		test("the image variant of a URL must be one of table 8", () => {
			assert.deepEqual(imageVariantOf(undefined), {})
			assert.deepEqual(imageVariantOf("https://example.com/sl"), {})
			assert.deepEqual(imageVariantOf("https://example.com/sl?image_variant=square_colour"), { imageVariant: "square_colour" })
			for (const value of ["16x9_grey", "16X9_COLOUR", "4x3_white", ""])
				assert.ok(imageVariantOf(`https://example.com/sl?image_variant=${value}`).parseErr?.[0].startsWith(`the image_variant "${value}" of the URL is not one of the image variants of A177`), value)
		})
	})

	// the service list of the SAT-IP example, with a content guide source whose endpoints are on a local server. The server
	// records each request and answers the schedules with 404 (so each request is one traversed document). With "refuse",
	// it answers a request with an image_variant with 400, and the same request without it with 200; with "refuseAll" it
	// answers both with 400
	describe("the requests of a validation", () => {
		const services = createServices(loadConfig({ ...defaults, nopl: true, nocsr: true, allow_traversal: true }))
		const requested: string[] = []
		let refuse = false, refuseAll = false, base = "", slText = "", slrText = ""
		const servers: Server[] = []
		before(async () => {
			configureFetchPolicy({ allowPrivateAddresses: true })
			const server = createServer((req, res) => {
				requested.push(req.url ?? "")
				const url = new URL(req.url ?? "", "http://localhost")
				if (refuseAll || (refuse && url.searchParams.has("image_variant"))) {
					res.statusCode = 400
					return res.end()
				}
				if (url.pathname == "/sl.xml" || refuse) {
					res.setHeader("Content-Type", "application/xml")
					return res.end(slText)
				}
				res.statusCode = 404
				res.end()
			})
			servers.push(server)
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
			base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
			slText = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8").replace(
				'\t<Service version="1">',
				`\t<ContentGuideSource CGSID="cgs1"><ProviderName>Example</ProviderName><ScheduleInfoEndpoint contentType="application/xml"><URI>${base}/schedule</URI></ScheduleInfoEndpoint><GroupInfoEndpoint contentType="application/xml"><URI>${base}/groups/</URI></GroupInfoEndpoint></ContentGuideSource>\n\t<Service version="1">`
			)
			const slrDir = join(import.meta.dirname, "test-005")
			slrText = readFileSync(join(slrDir, readdirSync(slrDir).find((f) => f.startsWith("0001") && f.endsWith(".xml"))!), "utf-8")
		})
		after(() => {
			servers.forEach((s) => { s.closeAllConnections(); s.close() })
			configureFetchPolicy({ allowPrivateAddresses: false })
		})
		const validateSL = async (options: Record<string, unknown>) => {
			const errs = new ErrorList()
			requested.length = 0
			await services.slcheck!.doValidateServiceList(slText, errs, { traverse: true, maxTraversal: Infinity, images: "no", report_schema_version: false, ...options })
			return errs
		}
		const traversed = (errs: ErrorList): ErrorList[] => errs.nestedErrors.flatMap((n) => [n, ...traversed(n)])
		const errorCodes = (errs: ErrorList) => errs.codesReported("errors").map(([code]) => code)

		test("every content guide request of a service list has the variant", async () => {
			await validateSL({ imageVariant: "16x9_colour_dark" })
			const schedules = requested.filter((u) => u.startsWith("/schedule")), groups = requested.filter((u) => u.startsWith("/groups/"))
			assert.equal(schedules.length, 1 + 57 * 4, "now/next and the windows of 28 days either side")
			assert.ok(schedules.some((u) => u.includes("now_next=true")))
			assert.ok(groups.some((u) => u.startsWith("/groups/categories?sid=")) && groups.includes("/groups/categories?image_variant=16x9_colour_dark"), groups.join())
			assert.deepEqual([...schedules, ...groups].filter((u) => !u.endsWith("image_variant=16x9_colour_dark")), [])
			assert.ok(schedules.filter((u) => u.includes("start=")).every((u) => u.includes("&inclusive=true&image_variant=")), "added at the end of the query")
		})
		test("without a variant, no request has one", async () => {
			const errs = await validateSL({})
			assert.ok(requested.length > 200 && requested.every((u) => !u.includes("image_variant")))
			assert.equal(errs.imageVariant, undefined)
		})
		test("a valid variant refused with 400, when the request succeeds without it, is IMV001", async () => {
			refuse = true
			try {
				const errs = await validateSL({ imageVariant: "square_colour", maxTraversal: 3 })
				const nowNext = traversed(errs).find((n) => n.type == "NowNext")!
				assert.deepEqual(errorCodes(nowNext), ["IMV001"])
				assert.ok(requested.some((u) => u.startsWith("/schedule?") && u.endsWith("now_next=true")), "requested again without the variant")
			} finally {
				refuse = false
			}
		})
		test("a request refused with or without the variant is VCG002, not IMV001", async () => {
			refuseAll = true
			try {
				const errs = await validateSL({ imageVariant: "square_colour", maxTraversal: 3 })
				const nowNext = traversed(errs).find((n) => n.type == "NowNext")!
				assert.deepEqual(errorCodes(nowNext), ["VCG002"], "the server refuses the request for another reason")
			} finally {
				refuseAll = false
			}
		})
		test("other failures keep their own codes", async () => {
			const errs = await validateSL({ imageVariant: "square_colour", maxTraversal: 3 })
			const nowNext = traversed(errs).find((n) => n.type == "NowNext")!
			assert.deepEqual(errorCodes(nowNext), ["VCG002"], "a 404")
		})
		test("the variant is in the results", async () => {
			const errs = await validateSL({ imageVariant: "4x3_colour", maxTraversal: 1 })
			assert.equal(errs.imageVariant, "4x3_colour")
			assert.equal((jsonResult(errs, "summary") as { imageVariant?: string }).imageVariant, "4x3_colour")
		})
		test("a variant that the revision does not define is IMV002, on the outermost document only", async () => {
			const r6 = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr6.xml"), "utf-8")
			const validate = async (text: string, imageVariant: string) => {
				const errs = new ErrorList()
				await services.slcheck!.doValidateServiceList(text, errs, { imageVariant, images: "no", report_schema_version: false })
				return errs.informationals.filter((e) => e.code == "IMV002")
			}
			const found = await validate(r6, "2x3_colour")
			assert.equal(found.length, 1)
			assert.equal(found[0].message, 'the image variant "2x3_colour" is not defined in A177r6 (it is from A177r8), so a server of this revision may refuse it')
			assert.deepEqual(await validate(r6, "16x9_colour"), [], "the 16:9 variants are in A177r6")
			assert.deepEqual(await validate(slText, "2x3_colour"), [], "an A177r8 list")
		})
		test("the service lists of a registry response are requested with the variant", async () => {
			// every service list of the response is on the local server, a different one for each (the elements of the response have
			// namespace prefixes, e.g. <slr:ServiceListURI> and <dt:URI>)
			let n = 0
			const withLists = slrText.replace(/(<(?:\w+:)?ServiceListURI[^>]*>\s*<(?:\w+:)?URI\b[^>]*>)[^<]*(<\/(?:\w+:)?URI>)/g, (_m, open, close) => `${open}${base}/sl.xml?n=${++n}${close}`)
			assert.ok(n >= 2, "the response has service list URIs")
			const errs = new ErrorList()
			requested.length = 0
			await services.slrcheck!.doValidateServiceListRegistry(withLists, errs, { traverse: true, maxTraversal: 2, images: "no", imageVariant: "square_colour" })
			const lists = errs.nestedErrors.map((nested) => nested.source ?? "")
			assert.equal(lists.length, n, "each is traversed, or skipped at the limit")
			assert.ok(lists.every((url) => url.endsWith("&image_variant=square_colour")), lists.join())
			assert.deepEqual(requested.filter((u) => u.startsWith("/sl.xml")), ["/sl.xml?n=1&image_variant=square_colour", "/sl.xml?n=2&image_variant=square_colour"], "the two within the limit are requested")
		})
	})

	// the images of a document requested with a variant: inline service logos in the SAT-IP example, with the images checked
	describe("the images of a variant", () => {
		const services = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true }))
		const SL = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8")
		const withLogo = (png: Buffer) =>
			SL.replace(
				/<ServiceType /,
				`<RelatedMaterial><tva:HowRelated href="urn:dvb:metadata:cs:HowRelatedCS:2021:1001.2"/><tva:MediaLocator><tva:MediaUri contentType="image/png">data:image/png;base64,${png.toString("base64")}</tva:MediaUri></tva:MediaLocator></RelatedMaterial><ServiceType `
			)
		const variantCodes = async (png: Buffer, imageVariant?: string) => {
			const errs = new ErrorList()
			configureFetchPolicy({ checkImages: true })
			try {
				await services.slcheck!.doValidateServiceList(withLogo(png), errs, { imageVariant, images: "yes", report_schema_version: false })
			} finally {
				configureFetchPolicy({ checkImages: false })
			}
			return [...errs.errors, ...errs.warnings].map((e) => e.code).filter((c) => c.startsWith("IMV") || c.startsWith("IMG")).sort()
		}
		test("the document has a place for a logo", () => assert.notEqual(withLogo(testPNG(1, 1)), SL))
		test("legitimate: the shape of the variant, and transparency for one on transparent", async () => {
			assert.deepEqual(await variantCodes(testPNG(320, 180), "16x9_colour_dark"), [])
			assert.deepEqual(await variantCodes(testPNG(200, 200), "square_white"), [])
			assert.deepEqual(await variantCodes(testPNG(320, 240), "4x3_colour"), [])
			assert.deepEqual(await variantCodes(testPNG(200, 300), "2x3_colour_light"), [])
			assert.deepEqual(await variantCodes(testPNG(320, 180, false, false), "16x9_colour"), [], "a colour variant needs no transparency")
		})
		test("boundary: within 1% of the shape", async () => {
			assert.deepEqual(await variantCodes(testPNG(321, 180), "16x9_colour"), [], "0.3%")
			assert.deepEqual(await variantCodes(testPNG(199, 200), "square_colour"), [], "0.5%, narrower than the shape")
		})
		test("invalid: another shape (IMV004)", async () => {
			assert.deepEqual(await variantCodes(testPNG(320, 320), "16x9_colour"), ["IMV004"])
			assert.deepEqual(await variantCodes(testPNG(320, 180), "square_colour"), ["IMV004"])
			assert.deepEqual(await variantCodes(testPNG(330, 180), "16x9_colour"), ["IMV004"], "3%")
		})
		test("invalid: no transparency for a variant on transparent (IMV005)", async () => {
			assert.deepEqual(await variantCodes(testPNG(320, 180, false, false), "16x9_colour_dark"), ["IMV005"])
			assert.deepEqual(await variantCodes(testPNG(320, 320, false, false), "16x9_white"), ["IMV004", "IMV005"])
		})
		test("not checked without a variant", async () => assert.deepEqual(await variantCodes(testPNG(320, 320, false, false)), []))
	})

	describe("the requests of a content guide", () => {
		const services = createServices(loadConfig({ ...defaults, nopl: true, noslr: true, nocsr: true, allow_traversal: true }))
		const BSCAT = readFileSync(join(import.meta.dirname, "test-009", "0001r8 bsCat.xml"), "utf-8")
		const NEXT = "urn:fvc:metadata:cs:HowRelatedCS:2015-12:pagination:next"
		const withNext = (url: string) =>
			BSCAT.replace("<Title>Category Group</Title>", `<Title>Category Group</Title><RelatedMaterial><HowRelated href="${NEXT}"/><MediaLocator><MediaUri contentType="application/xml">${url.replaceAll("&", "&amp;")}</MediaUri></MediaLocator></RelatedMaterial>`)
		const validate = async (text: string, imageVariant?: string) => {
			const errs = new ErrorList()
			await services.cgcheck!.doValidateContentGuide(text, "bsCategories", errs, { traverse: true, maxTraversal: 10, images: "no", imageVariant, grpInfo_ep: "https://cg.example.invalid/groups/" })
			return errs
		}
		const urls = (errs: ErrorList) => errs.nestedErrors.map((n) => n.source ?? "")
		test("the box set lists of the categories are requested with the variant", async () => {
			const found = urls(await validate(BSCAT, "16x9_white"))
			assert.ok(found.length >= 2, found.join())
			assert.ok(found.every((u) => u.startsWith("https://cg.example.invalid/groups/?groupId=") && u.endsWith("&image_variant=16x9_white")), found.join())
			assert.ok(urls(await validate(BSCAT)).every((u) => !u.includes("image_variant")))
		})
		test("a pagination link without the variant is IMV003, and is requested with it", async () => {
			const errs = await validate(withNext("https://cg.example.invalid/groups/categories?page=2"), "16x9_white")
			assert.equal(errs.informationals.filter((e) => e.code == "IMV003").length, 1)
			assert.ok(urls(errs).includes("https://cg.example.invalid/groups/categories?page=2&image_variant=16x9_white"), urls(errs).join())
		})
		test("a pagination link with another variant is IMV003, and is followed as it is", async () => {
			const errs = await validate(withNext("https://cg.example.invalid/groups/categories?page=2&image_variant=square_colour"), "16x9_white")
			assert.ok(errs.informationals.find((e) => e.code == "IMV003")!.message.includes('has the image variant "square_colour", but the request had "16x9_white"'))
			assert.ok(urls(errs).includes("https://cg.example.invalid/groups/categories?page=2&image_variant=square_colour"))
		})
		test("a pagination link that keeps the variant, and none without a variant", async () => {
			assert.equal((await validate(withNext("https://cg.example.invalid/groups/categories?page=2&image_variant=16x9_white"), "16x9_white")).informationals.filter((e) => e.code == "IMV003").length, 0)
			assert.equal((await validate(withNext("https://cg.example.invalid/groups/categories?page=2"))).informationals.filter((e) => e.code == "IMV003").length, 0)
		})
	})

	// the endpoints: /validate_* and /check, with a local server for the documents given by URL
	describe("the endpoints", () => {
		const config = loadConfig({ ...defaults, nocsr: true })
		const services = createServices(config)
		const requested: string[] = []
		const SL = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8")
		const servers: Server[] = []
		let docs = "", base = ""
		before(async () => {
			configureFetchPolicy({ allowPrivateAddresses: true })
			const docServer = createServer((req, res) => {
				requested.push(req.url ?? "")
				res.setHeader("Content-Type", "application/xml")
				res.end(SL)
			})
			const app = createServer(createApp(config, services))
			servers.push(docServer, app)
			await new Promise<void>((resolve) => docServer.listen(0, "127.0.0.1", resolve))
			await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
			docs = `http://127.0.0.1:${(docServer.address() as AddressInfo).port}`
			base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
		})
		after(() => {
			servers.forEach((s) => { s.closeAllConnections(); s.close() })
			configureFetchPolicy({ allowPrivateAddresses: false })
		})
		const slURL = (query = "") => encodeURIComponent(`${docs}/sl.xml${query}`)
		const json = async (query: string) => {
			requested.length = 0
			const r = await fetch(`${base}/validate_sl_json?url=${slURL(query)}`)
			return { status: r.status, body: (await r.json()) as { imageVariant?: string; parseErr?: string[] } }
		}
		test("the variant is that of the URL of the document, which is requested as it is", async () => {
			const { status, body } = await json("?image_variant=16x9_colour_light")
			assert.equal(status, 200)
			assert.deepEqual(requested, ["/sl.xml?image_variant=16x9_colour_light"])
			assert.equal(body.imageVariant, "16x9_colour_light")
		})
		test("without image_variant in the URL, there is none", async () => {
			const { body } = await json("")
			assert.deepEqual(requested, ["/sl.xml"])
			assert.equal(body.imageVariant, undefined)
		})
		test("an image_variant that is not in table 8 is refused with 400, and the document is not retrieved", async () => {
			for (const value of ["16x9_grey", "16X9_COLOUR", ""]) {
				const { status, body } = await json(`?image_variant=${value}`)
				assert.equal(status, 400, value)
				assert.ok(body.parseErr?.[0].startsWith(`the image_variant "${value}" of the URL is not one of the image variants of A177`), JSON.stringify(body.parseErr))
				assert.deepEqual(requested, [], value)
			}
		})
		test("image_variant= and X-image-variant are not choices of the request", async () => {
			requested.length = 0
			const own = (await (await fetch(`${base}/validate_sl_json?url=${slURL()}&image_variant=16x9_colour`)).json()) as { imageVariant?: string }
			assert.equal(own.imageVariant, undefined)
			assert.deepEqual(requested, ["/sl.xml"])
			const post = await fetch(`${base}/validate_sl_json`, { method: "POST", body: SL, headers: { "Content-Type": "application/xml", "X-image-variant": "4x3_colour" } })
			assert.equal(((await post.json()) as { imageVariant?: string }).imageVariant, undefined, "a POSTed document has no URL")
		})
		test("the HTML results name the variant", async () => {
			const page = await (await fetch(`${base}/validate_sl?url=${slURL("?image_variant=16x9_colour")}`)).text()
			assert.ok(page.includes("with image variant 16x9_colour"))
		})
		test("not applied to a playlist or an XML AIT, nor refused for them", async () => {
			requested.length = 0
			assert.equal((await fetch(`${base}/validate_pl_json?url=${encodeURIComponent(`${docs}/pl.xml?image_variant=bogus`)}`)).status, 200)
			const ait = (await (await fetch(`${base}/validate_ait_json?url=${encodeURIComponent(`${docs}/a.aitx?image_variant=16x9_colour`)}`)).json()) as { imageVariant?: string }
			assert.equal(ait.imageVariant, undefined)
			assert.deepEqual(requested, ["/pl.xml?image_variant=bogus", "/a.aitx?image_variant=16x9_colour"])
		})
		test("the /check form takes the variant from the URL", async () => {
			const form = await (await fetch(`${base}/check`)).text()
			assert.ok(!form.includes("imageVariant"), "the form does not ask for it")
			requested.length = 0
			const body = new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: `${docs}/sl.xml?image_variant=16x9_colour_dark`, images: "no" })
			const page = await (await fetch(`${base}/check`, { method: "POST", body })).text()
			assert.deepEqual(requested, ["/sl.xml?image_variant=16x9_colour_dark"])
			assert.ok(page.includes("with image variant 16x9_colour_dark"))
			requested.length = 0
			const bad = await (await fetch(`${base}/check`, { method: "POST", body: new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: `${docs}/sl.xml?image_variant=dark` }) })).text()
			assert.ok(bad.includes("the image_variant &quot;dark&quot; of the URL is not one of") || bad.includes("the image_variant &#34;dark&#34; of the URL is not one of"), "the URL is refused")
			assert.deepEqual(requested, [], "and not requested")
		})
	})
})

// the image variants a market requires (dvb-i-tools #153 phase 2, #139 DE-3): a service list is also requested with each
// of them, and each service with a service logo must have one in each. The service list of the SAT-IP example, with a
// service logo, is served by a local server, which gives each variant a document of its own (see "variants")
describe("Image variants required by a market", () => {
	const services = createServices(loadConfig({ ...defaults, nopl: true, nocsr: true, allow_traversal: true }))
	addMarkets(parseMarkets(JSON.stringify([{ id: "VARIANTS", name: "light and dark logos", revisions: [{ from: "r0", to: "latest", parameters: { imageVariants: { required: ["16x9_colour_light", "16x9_colour_dark"] } } }] }]), "test-app"))
	const SL = readFileSync(join(import.meta.dirname, "test-002", "SAT-IPr8.xml"), "utf-8")
	const SERVICE = "tag:daserste.de,2019:DasErste"
	const withLogo = (url: string) =>
		SL.replace(/<ServiceType /, `<RelatedMaterial><tva:HowRelated href="urn:dvb:metadata:cs:HowRelatedCS:2021:1001.2"/><tva:MediaLocator><tva:MediaUri contentType="image/png">${url}</tva:MediaUri></tva:MediaLocator></RelatedMaterial><ServiceType `)
	// how the server answers the request for each variant: "logo" (a service list whose logo is /logo-<variant>.png), "none"
	// (the service list without a logo), "absent" (without the service), "refuse" (400), "text" (not a service list) or
	// "default" (the same service list as without a variant, as a server that ignores the parameter gives)
	let variants: Record<string, string> = {}
	// the logos: "good" (320x180 with an alpha channel), "square" (those of the variants RGB, 320x320), "opaque" (all RGB,
	// 320x180) or "missing" (those of the variants 404)
	let logos = "good"
	const requested: string[] = []
	const servers: Server[] = []
	let base = ""
	before(async () => {
		configureFetchPolicy({ allowPrivateAddresses: true })
		const server = createServer((req, res) => {
			requested.push(req.url ?? "")
			const url = new URL(req.url ?? "", "http://localhost")
			if (url.pathname.startsWith("/logo")) {
				if (logos == "missing" && url.pathname != "/logo.png") {
					res.statusCode = 404
					return res.end()
				}
				res.setHeader("Content-Type", "image/png")
				if (logos == "opaque") return res.end(testPNG(320, 180, false, false))
				return res.end(logos == "square" && url.pathname != "/logo.png" ? testPNG(320, 320, false, false) : testPNG(320, 180))
			}
			const variant = url.searchParams.get("image_variant")
			const how = variant ? (variants[variant] ?? "logo") : "default"
			if (how == "refuse") {
				res.statusCode = 400
				return res.end()
			}
			res.setHeader("Content-Type", "application/xml")
			if (how == "text") return res.end("not a service list")
			if (how == "none") return res.end(SL)
			if (how == "absent") return res.end(withLogo(`${base}/logo-${variant}.png`).replace(`<UniqueIdentifier>${SERVICE}</UniqueIdentifier>`, "<UniqueIdentifier>tag:example.com,2026:another</UniqueIdentifier>"))
			res.end(withLogo(`${base}/logo${how == "default" ? "" : `-${variant}`}.png`))
		})
		servers.push(server)
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})
	after(() => {
		servers.forEach((s) => { s.closeAllConnections(); s.close() })
		configureFetchPolicy({ allowPrivateAddresses: false })
	})
	// the service list as retrieved from the server (with its logo /logo.png), validated with its URL
	const validate = async (options: { images?: "yes" | "no"; market?: string; documentUrl?: string } = {}) => {
		const errs = new ErrorList()
		requested.length = 0
		configureFetchPolicy({ checkImages: options.images == "yes" })
		try {
			await services.slcheck!.doValidateServiceList(withLogo(`${base}/logo.png`), errs, { market: options.market ?? "VARIANTS", images: options.images ?? "no", report_schema_version: false, documentUrl: options.documentUrl ?? `${base}/sl.xml` })
		} finally {
			configureFetchPolicy({ checkImages: false })
		}
		return errs
	}
	const codes = (errs: ErrorList) => [...errs.errors, ...errs.warnings, ...errs.informationals].map((e) => e.code).filter((c) => c.startsWith("MKT") || c.startsWith("IMV")).sort()
	const listRequests = () => requested.filter((u) => u.startsWith("/sl.xml"))

	test("the parameter in a markets file", () => {
		const settings = (required: unknown) => parseMarkets(JSON.stringify([{ id: "XX", name: "Test", revisions: [{ from: "r0", to: "r8", parameters: { imageVariants: { required } } }] }]), "test.json")[0].settings(A177Revision.r8).parameters.imageVariants
		assert.deepEqual(settings(["16x9_colour_dark"]), { required: ["16x9_colour_dark"] })
		for (const value of [[], ["16x9_grey"], ["16x9_colour_dark", "16x9_colour_dark"], "16x9_colour_dark", [3]])
			assert.throws(() => settings(value), (e: unknown) => e instanceof MarketsError && /"imageVariants.required" must be a list of image variants/.test((e as Error).message), JSON.stringify(value))
		assert.deepEqual(MARKET_DEFAULTS.parameters.imageVariants, {}, "A177 makes no variant mandatory")
		assert.deepEqual(findMarket("DE")!.settings(A177Revision.r6).parameters.imageVariants, { required: ["16x9_colour_light", "16x9_colour_dark"] }, "DE-3")
	})
	test("legitimate: a service logo in each variant", async () => {
		variants = {}
		const errs = await validate()
		assert.deepEqual(codes(errs), [])
		assert.deepEqual(listRequests().sort(), ["/sl.xml?image_variant=16x9_colour_dark", "/sl.xml?image_variant=16x9_colour_light"])
	})
	test("invalid: no service logo in a variant (MKT014)", async () => {
		variants = { "16x9_colour_dark": "none" }
		const errs = await validate()
		assert.deepEqual(codes(errs), ["MKT014"])
		assert.equal(errs.errors[0].message, `service "${SERVICE}" has a service logo, but none in the image variant "16x9_colour_dark", which the market VARIANTS requires`)
	})
	test("invalid: the service is not in the service list of a variant (MKT014)", async () => {
		variants = { "16x9_colour_light": "absent" }
		const errs = await validate()
		assert.deepEqual(codes(errs), ["MKT014"])
		assert.ok(errs.errors[0].message.includes("(the service is not in the service list of that variant)"))
	})
	test("invalid: a variant refused, or not a service list (MKT015)", async () => {
		variants = { "16x9_colour_light": "refuse", "16x9_colour_dark": "text" }
		const errs = await validate()
		assert.deepEqual(codes(errs), ["MKT015", "MKT015"])
		assert.ok(errs.errors.some((e) => e.message.includes("was answered with 400")))
		assert.ok(errs.errors.some((e) => e.message.includes("is not a service list")))
	})
	test("with images checked, the logos of each variant are checked against it", async () => {
		variants = {}
		logos = "good"
		try {
			assert.deepEqual(codes(await validate({ images: "yes" })), [])
			assert.ok(requested.includes("/logo-16x9_colour_light.png") && requested.includes("/logo-16x9_colour_dark.png"))
			logos = "square"
			const errs = await validate({ images: "yes" })
			assert.deepEqual(codes(errs), ["IMV004", "IMV004", "IMV005", "IMV005"], "a square logo without transparency, in each variant")
			assert.ok(errs.warnings.some((e) => e.message == `the service logo ${base}/logo-16x9_colour_dark.png of service "${SERVICE}" is 320x320, which is not 16:9 as the image variant "16x9_colour_dark" is`))
			logos = "missing"
			const missing = await validate({ images: "yes" })
			assert.deepEqual(codes(missing), ["MKT016", "MKT016"])
		} finally {
			logos = "good"
		}
	})
	test("a server that ignores the parameter gives the default logos, which are checked against the variants", async () => {
		variants = { "16x9_colour_light": "default", "16x9_colour_dark": "default" }
		logos = "opaque"
		try {
			assert.deepEqual(codes(await validate()), [], "without images, the logos are there")
			const errs = await validate({ images: "yes" })
			assert.deepEqual(codes(errs), ["IMV005", "IMV005"], "the default logo, which has no transparency, in each variant")
			assert.equal(requested.filter((u) => u == "/logo.png").length, 1, "retrieved once in the validation")
		} finally {
			logos = "good"
		}
	})
	test("without images checked, the logos are not retrieved", async () => {
		variants = {}
		await validate()
		assert.deepEqual(requested.filter((u) => u.startsWith("/logo")), [])
	})
	test("the variant that the service list was requested with is not requested again", async () => {
		variants = {}
		await validate({ documentUrl: `${base}/sl.xml?image_variant=16x9_colour_dark` })
		assert.deepEqual(listRequests(), ["/sl.xml?image_variant=16x9_colour_light"])
	})
	test("a service list without a URL is not compared (MKT017), unless it has no service logo", async () => {
		const errs = new ErrorList()
		await services.slcheck!.doValidateServiceList(withLogo(`${base}/logo.png`), errs, { market: "VARIANTS", images: "no", report_schema_version: false })
		assert.deepEqual(codes(errs), ["MKT017"])
		const noLogo = new ErrorList()
		await services.slcheck!.doValidateServiceList(SL, noLogo, { market: "VARIANTS", images: "no", report_schema_version: false })
		assert.deepEqual(codes(noLogo), [])
	})
	test("without the market, no variant is requested", async () => {
		const errs = await validate({ market: "" })
		assert.deepEqual(codes(errs), [])
		assert.deepEqual(listRequests(), [])
	})
	test("a service list traversed from a registry response is compared too", async () => {
		variants = { "16x9_colour_dark": "none" }
		const slrDir = join(import.meta.dirname, "test-005")
		const slr = readFileSync(join(slrDir, readdirSync(slrDir).find((f) => f.startsWith("0001") && f.endsWith(".xml"))!), "utf-8")
		const withList = slr.replace(/(<(?:\w+:)?ServiceListURI[^>]*>\s*<(?:\w+:)?URI\b[^>]*>)[^<]*(<\/(?:\w+:)?URI>)/, `$1${base}/sl.xml$2`)
		const errs = new ErrorList()
		requested.length = 0
		await services.slrcheck!.doValidateServiceListRegistry(withList, errs, { traverse: true, maxTraversal: 1, market: "VARIANTS", images: "no" })
		const nested = errs.nestedErrors.find((n) => n.source == `${base}/sl.xml`)!
		assert.ok(nested, errs.nestedErrors.map((n) => n.source).join())
		assert.deepEqual(nested.codesReported("errors").map(([code]) => code).filter((c) => c.startsWith("MKT")), ["MKT014"])
		assert.ok(requested.includes("/sl.xml?image_variant=16x9_colour_light"))
	})
	test("POST and the /check form pass the URL of the service list", async () => {
		variants = { "16x9_colour_dark": "none" }
		const app = createServer(createApp(loadConfig({ ...defaults, nocsr: true }), services))
		servers.push(app)
		await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
		const appBase = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
		const json = (await (await fetch(`${appBase}/validate_sl_json?url=${encodeURIComponent(`${base}/sl.xml`)}&market=VARIANTS&images=no`)).json()) as { errors: number }
		assert.ok(json.errors >= 1, "MKT014 for the dark variant")
		assert.ok(requested.includes("/sl.xml?image_variant=16x9_colour_dark"))
		requested.length = 0
		const page = await (await fetch(`${appBase}/check`, { method: "POST", body: new URLSearchParams({ testtype: "sl", doclocation: "url", XMLurl: `${base}/sl.xml`, market: "VARIANTS", images: "no" }) })).text()
		assert.ok(page.includes("MKT014"))
		assert.ok(requested.includes("/sl.xml?image_variant=16x9_colour_light"))
	})
})
