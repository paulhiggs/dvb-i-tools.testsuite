import { test } from 'node:test';

import { BCP47_Language_Tag } from "../../lib/pattern_checks.mjs";
import { isMIME } from "../../lib/MIME_checks.mjs";
import { dvbi } from "../../lib/DVB-I_definitions.mjs";

import {
	e_IPv6Address,
	e_IPv4Address,
	isDVBLocator,
	isPostcode,
	isWildcardPostcode,
	validExtensionName,
	validFrameRate,
	isISODuration,
	isURL,
	isURN,
	isHTTPURL,
	isDataURI,
	validZuluTimeType,
	isUTCDateTime,
	isUUIDformat,
	isTAGURI,
} from "../../lib/pattern_checks.mjs";


test('Regular Expressions', (t) => {

	t.test("Languages", (t) => {

		const re = new RegExp(`^${BCP47_Language_Tag}$`);

		t.assert.strictEqual(re.test(""), false);
		t.assert.strictEqual(re.test("eng"), true);
		t.assert.strictEqual(re.test("english"), true);
		t.assert.strictEqual(re.test("engl!sh"), false)

		t.assert.strictEqual(re.test("zh-Hant-CN-x-private1-private2"), true);
		t.assert.strictEqual(re.test("zh-Hant-CN-x-private1"), true);
		t.assert.strictEqual(re.test("zh-Hant-CN"), true);
		t.assert.strictEqual(re.test("zh-Hant"), true);
		t.assert.strictEqual(re.test("zh-hant"), false);
		t.assert.strictEqual(re.test("zh"), true);

		t.assert.strictEqual(re.test("zh-Hant-CN-x-"), false);
		t.assert.strictEqual(re.test("zh-Hant-CN-x"), false);
		t.assert.strictEqual(re.test("zh-"), false);
		t.assert.strictEqual(re.test("zh-ziang"), true);

		t.assert.strictEqual(re.test("de"), true);
		t.assert.strictEqual(re.test("de-CH"), true);
		t.assert.strictEqual(re.test("de-CH-1901"), true);
		t.assert.strictEqual(re.test("es-419"), true);
		t.assert.strictEqual(re.test("es-4192"), true);
		t.assert.strictEqual(re.test("es-41"), false);
		t.assert.strictEqual(re.test("es-90210"), false);
		t.assert.strictEqual(re.test("sl-IT-nedis"), true);
		t.assert.strictEqual(re.test("en-US-boont"), true);
		t.assert.strictEqual(re.test("mn-Cyrl-MN"), true);
		t.assert.strictEqual(re.test("x-fr-CH"), true);
		t.assert.strictEqual(re.test("en-GB-boont-r-extended-sequence-x-private"), true);
		t.assert.strictEqual(re.test("sr-Cyrl"), true);
		t.assert.strictEqual(re.test("sr-Latn"), true);
		t.assert.strictEqual(re.test("hy-Latn-IT-arevela"), true);
		t.assert.strictEqual(re.test("zh-TW"), true);
	});

	t.test("MIME Types", (t) => {

		t.assert.strictEqual(isMIME(""), false);

		t.test("AIT", (t) => {
			t.assert.strictEqual(isMIME(dvbi.XML_AIT_CONTENT_TYPE), true);
		});

		t.test("HTML5 App", (t) => {
			t.assert.strictEqual(isMIME(dvbi.HTML5_APP), true);
		});

		t.test("XHTML App", (t) => {
			t.assert.strictEqual(isMIME(dvbi.XHTML_APP), true);
		});

		t.test("XML App", (t) => {
			t.assert.strictEqual(isMIME(dvbi.XML_APP), true);
		});

		t.test("JPEG", (t) => {
			t.assert.strictEqual(isMIME("image/jpeg"), true);
		});

		t.test("PNG", (t) => {
			t.assert.strictEqual(isMIME("image/png"), true);
		});

		t.test("not MIME", (t) => {
			t.assert.strictEqual(isMIME("banana"), false);
			t.assert.strictEqual(isMIME("/apple"), false);
		});
	});

	t.test("4CC", (t) => {

		const AVCregex = /[a-z0-9!"#$%&'()*+,./:;<=>?@[\] ^_`{|}~-]{4}\.[a-f0-9]{6}/i;
		const AC4regex = /ac-4(\.[a-fA-F\d]{1,2}){3}/;
		const VP9regex = /^vp09(\.\d{2}){3}(\.(\d{2})?){0,5}$/;
		const AV1regex = /^av01\.\d\.\d+[MH]\.\d{1,2}((\.\d?)(\.(\d{3})?(\.(\d{2})?(.(\d{2})?(.(\d{2})?(.\d?)?)?)?)?)?)?$/;

		t.test("AVC", (t) => {
			t.assert.strictEqual(AVCregex.test("avc1.001122"), true);
		})
		t.test("AC-4", (t) => {
			t.assert.strictEqual(AC4regex.test("ac-4.00.11.22"), true);
		})
		t.test("VP9", (t) => {
			t.assert.strictEqual(VP9regex.test("vp09.00.11.22"), true);
			t.assert.strictEqual(VP9regex.test("vp09.00.11.22..12.03.."), true);
		})
		t.test("AV1", (t) => {
			t.assert.strictEqual(AV1regex.test("av01.0.04M.10.0.112.09.16.09.0"), true);
			t.assert.strictEqual(AV1regex.test("av01.0.04M.12"), true);
			t.assert.strictEqual(AV1regex.test("av01.0.04H.8..112....0"), true);
		})
	})

	t.test("IPv6", (t) => {
		const re=new RegExp(`^${e_IPv6Address}$`);

		t.assert.strictEqual(re.test(""), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:8"), true);
		t.assert.strictEqual(re.test("1::"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7::"), true);
		t.assert.strictEqual(re.test("1::8"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5:6::8"), true);
		t.assert.strictEqual(re.test("1::7:8"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5::7:8"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5::8"), true);
		t.assert.strictEqual(re.test("1::6:7:8"), true);
		t.assert.strictEqual(re.test("1:2:3:4::6:7:8"), true);
		t.assert.strictEqual(re.test("1:2:3:4::8"), true);
		t.assert.strictEqual(re.test("1::5:6:7:8"), true);
		t.assert.strictEqual(re.test("1:2:3::5:6:7:8"), true);
		t.assert.strictEqual(re.test("1:2:3::8"), true);
		t.assert.strictEqual(re.test("1::4:5:6:7:8"), true);
		t.assert.strictEqual(re.test("1:2::4:5:6:7:8"), true);
		t.assert.strictEqual(re.test("1:2::8"), true);
		t.assert.strictEqual(re.test("1::3:4:5:6:7:8"), true);
		t.assert.strictEqual(re.test("1::8"), true);
		t.assert.strictEqual(re.test("::2:3:4:5:6:7:8"), true);
		t.assert.strictEqual(re.test("::8"), true);
		t.assert.strictEqual(re.test("::"), true);
		t.assert.strictEqual(re.test("fe08::7:8%eth0"), true);
		t.assert.strictEqual(re.test("fe08::7:8%1"), true);
		t.assert.strictEqual(re.test("::255.255.255.255"), true);
		t.assert.strictEqual(re.test("::ffff:255.255.255.255"), true);
		t.assert.strictEqual(re.test("2001:db8:3:4::192.0.2.33"), true);
		t.assert.strictEqual(re.test("64:ff9b::192.0.2.3"), true);
		t.assert.strictEqual(re.test("::ffff:10.0.0.1"), true);
		t.assert.strictEqual(re.test("::ffff:1.2.3.4"), true);
		t.assert.strictEqual(re.test("::ffff:0.0.0.0"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:77:88"), true);
		t.assert.strictEqual(re.test("fe08::7:8"), true);
		t.assert.strictEqual(re.test("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), true);
		t.assert.strictEqual(re.test("::ffff:0:255.255.255.255"), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:8:9"), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6::7:8"), false);
		t.assert.strictEqual(re.test(":1:2:3:4:5:6:7:8"), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:8:"), false);
		t.assert.strictEqual(re.test("::1:2:3:4:5:6:7:8"), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:8::"), false);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:88888"), false);
		t.assert.strictEqual(re.test("2001:db8:3:4:5::192.0.2.33"), false);
		t.assert.strictEqual(re.test("fe08::7:8%"), false);
		t.assert.strictEqual(re.test("fe08::7:8i"), false);
		t.assert.strictEqual(re.test("fe08::7:8interface"), false);
	})

	t.test("IPv4", (t) => {
		const re = new RegExp(`^${e_IPv4Address}$`)

		t.assert.strictEqual(re.test("192.0.2.3"), true);
		t.assert.strictEqual(re.test("192..2.3"), false);
		t.assert.strictEqual(re.test("192.0"), false);
		t.assert.strictEqual(re.test("127.0.0.1"), true);
		t.assert.strictEqual(re.test("292.168.0.1"), false);
		t.assert.strictEqual(re.test("10002.3.4"), false);
		t.assert.strictEqual(re.test("1.2.3.4.5"), false);
		t.assert.strictEqual(re.test("256.0.0.0"), false);
		t.assert.strictEqual(re.test("260.0.0.0"), false);
		t.assert.strictEqual(re.test("0.0.0.0"), true);
		t.assert.strictEqual(re.test("255.255.255.255"), true);
		t.assert.strictEqual(re.test("192.168.1.1"), true);
		t.assert.strictEqual(re.test("10.0.0.1"), true);
		t.assert.strictEqual(re.test("1:2:3:4:5:6:7:8"), false);
		t.assert.strictEqual(re.test("64:ff9b::192.0.2.3"), false);
	})

	t.test("DVB Locator", (t) => {
		t.assert.strictEqual(isDVBLocator(""), false);
		t.assert.strictEqual(isDVBLocator("dvb://.."), false);
		t.assert.strictEqual(isDVBLocator("dvb://aa.bb.cc"), false);
		t.assert.strictEqual(isDVBLocator("dvb://6d..99;1"), true);
		t.assert.strictEqual(isDVBLocator("dvb://a0a.1bb.cc2;12d"), true);
	})

	t.test("Postcodes", (t) => {
		t.assert.strictEqual(isPostcode(""), false);
		t.assert.strictEqual(isPostcode("rg4-5hj"), true);
		t.assert.strictEqual(isPostcode("RG4 5HJ"), true);
		t.assert.strictEqual(isPostcode("RG4.5HJ"), false);
		t.assert.strictEqual(isPostcode("30324"), true);
		t.assert.strictEqual(isPostcode("90210"), true);
	})

	t.test("wildcard Postcodes", (t) => {
		t.assert.strictEqual(isWildcardPostcode(""), false);
	//	t.assert.strictEqual(isWildcardPostcode("*"), true);
		t.assert.strictEqual(isWildcardPostcode("W12 7TQ"), false);
		t.assert.strictEqual(isWildcardPostcode("W12-7TQ"), false);
		t.assert.strictEqual(isWildcardPostcode("*12-7TQ"), true);
		t.assert.strictEqual(isWildcardPostcode("W12-*"), true);
		t.assert.strictEqual(isWildcardPostcode("300*"), true);
		t.assert.strictEqual(isWildcardPostcode("9*0"), true);
		t.assert.strictEqual(isWildcardPostcode("9**0"), false);
		t.assert.strictEqual(isWildcardPostcode("9*-*0"), false);
	})

	t.test("Extension Types", (t) => {
		t.assert.strictEqual(validExtensionName(""), false);
		t.assert.strictEqual(validExtensionName("HBBTV"), true);
		t.assert.strictEqual(validExtensionName("DVB-HB"), true);
		t.assert.strictEqual(validExtensionName("HBB.TV"), true);
		t.assert.strictEqual(validExtensionName("@HBBTV"), false);
	})

	t.test("Frame Rates", (t) => {
		t.assert.strictEqual(validFrameRate(""), false);
		t.assert.strictEqual(validFrameRate("high"), false);
		t.assert.strictEqual(validFrameRate("120"), true);
		t.assert.strictEqual(validFrameRate("59.96"), true);
		t.assert.strictEqual(validFrameRate("120/1.001"), true);
	})

	t.test("URLs", (t) => {
		t.assert.strictEqual(isURL(""), false);
		t.assert.strictEqual(isURL("http://github.com/"), true);
		t.assert.strictEqual(isURL("https://github.com"), true);
		t.assert.strictEqual(isURL("mailto:someone@mycompany.com"), true);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?subject=Mail from Our Site"), false);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?subject=Mail%20from%20Our%20Site"), true);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News"), false);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News"), true);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here"), false);
		t.assert.strictEqual(isURL("mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here"), true);

	})

	t.test("HTTP URLs", (t) => {
		t.assert.strictEqual(isHTTPURL(""), false);
		t.assert.strictEqual(isHTTPURL("http://github.com/"), true);
		t.assert.strictEqual(isHTTPURL("https://github.com/"), true);
		t.assert.strictEqual(isHTTPURL("http://where.co.uk/dvb-i/serviceList.php?id=331"), true);
		t.assert.strictEqual(isHTTPURL("https://where.co.uk/dvb-i/serviceList.php?id=331"), true);
		t.assert.strictEqual(isHTTPURL("mailto:paul"), false);
	})

	t.test("data: URI", (t) => {
		t.assert.strictEqual(isDataURI(""), false);
		t.assert.strictEqual(isDataURI("data:image/png;base64,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"), true);
		t.assert.strictEqual(isDataURI("data:image/png;base64,iVBORw0KG"), true);
		t.assert.strictEqual(isDataURI("data:image/jpeg;base64,UEsDBBQAAAAI"), true);
		t.assert.strictEqual(isDataURI("data:image/jpeg;key=value;base64,UEsDBBQAAAAI"), true);
		t.assert.strictEqual(isDataURI("data:image/jpeg;key=value,UEsDBBQAAAAI"), true);
		t.assert.strictEqual(isDataURI("data:;base64;sdfgsdfgsdfasdfa=s,UEsDBBQAAAAI"), true);
		t.assert.strictEqual(isDataURI("data:,UEsDBBQAAAAI"), true);
	})

	t.test("tag: URI", (t) => {
		t.assert.strictEqual(isTAGURI(""), false);
		t.assert.strictEqual(isTAGURI("tag:sandt.com:uk,2023:SandT‑Service‑1"), false);
		t.assert.strictEqual(isTAGURI("tag:sandt.com.uk,2023:SandT‑Service‑1"), false);
		t.assert.strictEqual(isTAGURI("tag:sandt.com.uk,2023:SandT-Service-1"), true);
		t.assert.strictEqual(isTAGURI("tag:sandt.com.uk,2023:SandT‑Service‑1‑The Legend of Boggy Creek (1972)"), false);
		t.assert.strictEqual(isTAGURI("tag:sandt.com.uk,2023:SandT-Service-1-The%20Legend%20of%20Boggy%20Creek%20(1972)"), true);
	})

	t.test("URNs", (t) => {
		t.assert.strictEqual(isURN(""), false);
		t.assert.strictEqual(isURN("urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2"), true);
	})

	t.test("ISO Durations", (t) => {
		t.assert.strictEqual(isISODuration(""), false);
		t.assert.strictEqual(isISODuration("PT1H"), true);
		t.assert.strictEqual(isISODuration("PT1H00M00S"), true);
		t.assert.strictEqual(isISODuration("PT45M"), true);
		t.assert.strictEqual(isISODuration("PT1H16.3S"), true);
		t.assert.strictEqual(isISODuration("+PT1H16.3S"), true);
		t.assert.strictEqual(isISODuration("-PT1H16.3S"), true);
		t.assert.strictEqual(isISODuration("P3Y6M4DT12H30M5S"), true);
		t.assert.strictEqual(isISODuration("P-3Y6M4DT12H30M5S"), true);
		t.assert.strictEqual(isISODuration("P3MT"), false);
		t.assert.strictEqual(isISODuration("PT"), false);
		t.assert.strictEqual(isISODuration("P"), false);
		t.assert.strictEqual(isISODuration("P3DT"), false);
	})

	t.test("Zulu times", (t) => {
		t.assert.strictEqual(validZuluTimeType(""), false);
		t.assert.strictEqual(validZuluTimeType("24:00:00Z"), false);
		t.assert.strictEqual(validZuluTimeType("09:30-05:00"), false);
		t.assert.strictEqual(validZuluTimeType("09:30+08:30"), false);
		t.assert.strictEqual(validZuluTimeType("09:30+12"), false);
	})

	t.test("UTC times", (t) => {
		t.assert.strictEqual(isUTCDateTime(""), false);
		t.assert.strictEqual(isUTCDateTime("2024-08-20T12:45:15.000Z"), true);
		t.assert.strictEqual(isUTCDateTime("2024-08-20T12:45:15Z"), true);
		t.assert.strictEqual(isUTCDateTime("2014-07-15T20:42:30Z"), true);
	})

	t.test("UUID", (t) => {
		t.assert.strictEqual(isUUIDformat(""), false);
		t.assert.strictEqual(isUUIDformat("3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c"), true);
		t.assert.strictEqual(isUUIDformat("3D5E6D35-9B9A-41E8-B843-DD3C6E72C42C"), true);
		t.assert.strictEqual(isUUIDformat("bananass-food-cats-dogs-transformate"), false);
		t.assert.strictEqual(isUUIDformat("ThisIsNotA UUID"), false);
	})
})