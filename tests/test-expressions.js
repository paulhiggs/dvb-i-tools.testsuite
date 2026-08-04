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


function expression_test(parentTest, re, input, expected) {
	parentTest.test(`"${input}"`, (t) => {
		t.assert.strictEqual(re.test(input), expected);
	});
}

function function_test(parentTest, fn, input, expected) {
	parentTest.test(`"${input}"`, (t) => {
		t.assert.strictEqual(fn(input), expected);
	});
}


test('Regular Expressions', (t) => {

	t.test("Languages", (t) => {

		const re = new RegExp(`^${BCP47_Language_Tag}$`);

		expression_test(t, re, "", false);

		expression_test(t, re, "eng", true);
		expression_test(t, re, "english", true);
		expression_test(t, re, "engl!sh", false);

		expression_test(t, re, "zh-Hant-CN-x-private1-private2", true);
		expression_test(t, re, "zh-Hant-CN-x-private1", true);
		expression_test(t, re, "zh-Hant-CN", true);
		expression_test(t, re, "zh-Hant", true);
		expression_test(t, re, "zh-hant", false);
		expression_test(t, re, "zh", true);

		expression_test(t, re, "zh-Hant-CN-x-", false);
		expression_test(t, re, "zh-Hant-CN-x", false);
		expression_test(t, re, "zh-", false);
		expression_test(t, re, "zh-ziang", true);

		expression_test(t, re, "de", true);
		expression_test(t, re, "de-CH", true);
		expression_test(t, re, "de-CH-1901", true);
		expression_test(t, re, "es-419", true);
		expression_test(t, re, "es-4192", true);
		expression_test(t, re, "es-41", false);
		expression_test(t, re, "es-90210", false);
		expression_test(t, re, "sl-IT-nedis", true);
		expression_test(t, re, "en-US-boont", true);
		expression_test(t, re, "mn-Cyrl-MN", true);
		expression_test(t, re, "x-fr-CH", true);
		expression_test(t, re, "en-GB-boont-r-extended-sequence-x-private", true);
		expression_test(t, re, "sr-Cyrl", true);
		expression_test(t, re, "sr-Latn", true);
		expression_test(t, re, "hy-Latn-IT-arevela", true);
		expression_test(t, re, "zh-TW", true);
	});

	t.test("MIME Types", (t) => {

		function_test(t, isMIME, "", false);

		t.test("AIT", (t) => {
			function_test(t, isMIME, dvbi.XML_AIT_CONTENT_TYPE, true);
		});

		t.test("HTML5 App", (t) => {
			function_test(t, isMIME, dvbi.HTML5_APP, true);
		});

		t.test("XHTML App", (t) => {
			function_test(t, isMIME, dvbi.XHTML_APP, true);
		});

		t.test("XML App", (t) => {
			function_test(t, isMIME, dvbi.XML_APP, true);
		});

		t.test("JPEG", (t) => {
			function_test(t, isMIME, "image/jpeg", true);
		});

		t.test("PNG", (t) => {
			function_test(t, isMIME, "image/png", true);
		});

		t.test("not MIME", (t) => {
			function_test(t, isMIME, "banana", false);
			function_test(t, isMIME, "/apple", false);
		});
	});

	t.test("4CC", (t) => {

		const AVCregex = /^avc[1-4]\.[a-f\d]{6}$/i,
			AC4regex = /^ac-4(\.[a-fA-F\d]{1,2}){3}$/,
			VP9regex = /^vp09(\.\d{2}){3}(\.(\d{2})?){0,5}$/,
			AV1regex = /^av01\.\d\.\d+[MH]\.\d{1,2}((\.\d?)(\.(\d{3})?(\.(\d{2})?(.(\d{2})?(.(\d{2})?(.\d?)?)?)?)?)?)?$/,

			IMAFregex = /^iamf\.\d{3}\.\d{3}\.(Opus|mp4a(\.[a-fA-F\d]{2})(\.\d+)?|flaC|ipcm)/,
			// EAC3regex = /^eac3\.\d{3}\.\d{3}(\.(\d{2})?){0,5}$/,
			AVS3Vregex = /(avs3|lav3)(\.[a-fA-F\d]{2}){2}$/,
			AVS3Aregex = /av3a\.[a-fA-F\d]{1,2}$/,
			AVS2Aregex = /cavs\.[a-fA-F\d]{1,2}$/,
			DolbyVregex = /^(dvav|dvhe|dvh1|dva1|dav1)\.\d{2}\.\d{2}$/,
			VVCregex = /^(vvc1|vvi1)(\.\d+)(\.[LH]\d+)(\.C[a-zA-Z2-7]+)?(\.S[a-fA-F\d]{1,2}(\+[a-fA-F\d]{1,2})*)?(\.O\d+(\+\d+)?)?$/,
			MPEGHregex = /mhm(1|2)\.0x[a-fA-F\d]{2}$/,
			CUVVregex = /cuvv.[01]+$/;

		t.test("AVC", (t) => {
			expression_test(t, AVCregex, "avc1.001122", true);
		})
		t.test("AC-4", (t) => {
			expression_test(t, AC4regex, "ac-4.00.11.22", true);
		})
		t.test("VP9", (t) => {
			expression_test(t, VP9regex, "vp09.00.11.22", true);
			expression_test(t, VP9regex, "vp09.00.11.22..12.03..", true);
		})
		t.test("AV1", (t) => {
			expression_test(t, AV1regex, "av01.0.04M.10.0.112.09.16.09.0", true);
			expression_test(t, AV1regex, "av01.0.04M.12", true);
			expression_test(t, AV1regex, "av01.0.04H.8..112....0", true);
		})
	})

	t.test("IPv6", (t) => {
		const re=new RegExp(`^${e_IPv6Address}$`);

		expression_test(t, re, "", false);
		expression_test(t, re, "1:2:3:4:5:6:7:8", true);
		expression_test(t, re, "1::", true);
		expression_test(t, re, "1:2:3:4:5:6:7::", true);
		expression_test(t, re, "1::8", true);
		expression_test(t, re, "1:2:3:4:5:6::8", true);
		expression_test(t, re, "1::7:8", true);
		expression_test(t, re, "1:2:3:4:5::7:8", true);
		expression_test(t, re, "1:2:3:4:5::8", true);
		expression_test(t, re, "1::6:7:8", true);
		expression_test(t, re, "1:2:3:4::6:7:8", true);
		expression_test(t, re, "1:2:3:4::8", true);
		expression_test(t, re, "1::5:6:7:8", true);
		expression_test(t, re, "1:2::4:5:6:7:8", true);
		expression_test(t, re, "1:2::8", true);
		expression_test(t, re, "1::3:4:5:6:7:8", true);
		expression_test(t, re, "1::8", true);
		expression_test(t, re, "::2:3:4:5:6:7:8", true);
		expression_test(t, re, "::8", true);
		expression_test(t, re, "::", true);
		expression_test(t, re, "fe08::7:8%eth0", true);
		expression_test(t, re, "fe08::7:8%1", true);
		expression_test(t, re, "::255.255.255.255", true);
		expression_test(t, re, "::ffff:255.255.255.255", true);
		expression_test(t, re, "2001:db8:3:4::192.0.2.33", true);
		expression_test(t, re, "64:ff9b::192.0.2.3", true);
		expression_test(t, re, "::ffff:10.0.0.1", true);
		expression_test(t, re, "::ffff:1.2.3.4", true);
		expression_test(t, re, "::ffff:0.0.0.0", true);
		expression_test(t, re, "1:2:3:4:5:6:77:88", true);
		expression_test(t, re, "fe08::7:8", true);
		expression_test(t, re, "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true);
		expression_test(t, re, "::ffff:0:255.255.255.255", false);
		expression_test(t, re, "1:2:3:4:5:6:7:8:9", false);
		expression_test(t, re, "1:2:3:4:5:6::7:8", false);
		expression_test(t, re, ":1:2:3:4:5:6:7:8", false);
		expression_test(t, re, "1:2:3:4:5:6:7:8:", false);
		expression_test(t, re, "::1:2:3:4:5:6:7:8", false);
		expression_test(t, re, "1:2:3:4:5:6:7:8::", false);
		expression_test(t, re, "1:2:3:4:5:6:7:88888", false);
		expression_test(t, re, "2001:db8:3:4:5::192.0.2.33", false);
		expression_test(t, re, "fe08::7:8%", false);
		expression_test(t, re, "fe08::7:8i", false);
		t.assert.strictEqual(re.test("fe08::7:8interface"), false);
	})

	t.test("IPv4", (t) => {
		const re = new RegExp(`^${e_IPv4Address}$`)

		expression_test(t, re, "", false);
		expression_test(t, re, "192.0.2.3", true);
		expression_test(t, re, "192..2.3", false);
		expression_test(t, re, "192.0", false);
		expression_test(t, re, "127.0.0.1", true);
		expression_test(t, re, "292.168.0.1", false);
		expression_test(t, re, "10002.3.4", false);
		expression_test(t, re, "1.2.3.4.5", false);
		expression_test(t, re, "256.0.0.0", false);
		expression_test(t, re, "260.0.0.0", false);
		expression_test(t, re, "0.0.0.0", true);
		expression_test(t, re, "255.255.255.255", true);
		expression_test(t, re, "192.168.1.1", true);
		expression_test(t, re, "10.0.0.1", true);
		expression_test(t, re, "1:2:3:4:5:6:7:8", false);
		expression_test(t, re, "64:ff9b::192.0.2.3", false);
	})

	t.test("DVB Locator", (t) => {
		function_test(t, isDVBLocator, "", false);
		function_test(t, isDVBLocator, "dvb://..", false);
		function_test(t, isDVBLocator, "dvb://aa.bb.cc", false);
		function_test(t, isDVBLocator, "dvb://6d..99;1", true);
		function_test(t, isDVBLocator, "dvb://a0a.1bb.cc2;12d", true);
	})

	t.test("Postcodes", (t) => {
		function_test(t, isPostcode, "", false);
		function_test(t, isPostcode, "rg4-5hj", true);
		function_test(t, isPostcode, "RG4 5HJ", true);
		function_test(t, isPostcode, "RG4.5HJ", false);
		function_test(t, isPostcode, "30324", true);
		function_test(t, isPostcode, "90210", true);
	})

	t.test("wildcard Postcodes", (t) => {
		function_test(t, isWildcardPostcode, "", false);
	//	function_test(t, isWildcardPostcode, "*", true);
		function_test(t, isWildcardPostcode, "W12 7TQ", false);
		function_test(t, isWildcardPostcode, "W12-7TQ", false);
		function_test(t, isWildcardPostcode, "*12-7TQ", true);
		function_test(t, isWildcardPostcode, "W12-*", true);
		function_test(t, isWildcardPostcode, "300*", true);
		function_test(t, isWildcardPostcode, "9*0", true);
		function_test(t, isWildcardPostcode, "9**0", false);
		function_test(t, isWildcardPostcode, "9*-*0", false);
	})

	t.test("Extension Types", (t) => {
		function_test(t, validExtensionName, "", false);
		function_test(t, validExtensionName, "HBBTV", true);
		function_test(t, validExtensionName, "DVB-HB", true);
		function_test(t, validExtensionName, "HBB.TV", true);
		function_test(t, validExtensionName, "@HBBTV", false);
	})

	t.test("Frame Rates", (t) => {
		function_test(t, validFrameRate, "", false);
		function_test(t, validFrameRate, "high", false);
		function_test(t, validFrameRate, "120", true);
		function_test(t, validFrameRate, "59.96", true);
		function_test(t, validFrameRate, "120/1.001", true);
	})

	t.test("URLs", (t) => {
		function_test(t, isURL, "", false);
		function_test(t, isURL, "http://github.com/", true);
		function_test(t, isURL, "https://github.com", true);
		function_test(t, isURL, "mailto:someone@mycompany.com", true);
		function_test(t, isURL, "mailto:someone@yoursite.com?subject=Mail from Our Site", false);
		function_test(t, isURL, "mailto:someone@yoursite.com?subject=Mail%20from%20Our%20Site", true);
		function_test(t, isURL, "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News", false);
		function_test(t, isURL, "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News", true);
		function_test(t, isURL, "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here", false);
		function_test(t, isURL, "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here", true);

	})

	t.test("HTTP URLs", (t) => {
		function_test(t, isHTTPURL, "", false);
		function_test(t, isHTTPURL, "http://github.com/", true);
		function_test(t, isHTTPURL, "https://github.com/", true);
		function_test(t, isHTTPURL, "http://where.co.uk/dvb-i/serviceList.php?id=331", true);
		function_test(t, isHTTPURL, "https://where.co.uk/dvb-i/serviceList.php?id=331", true);
		function_test(t, isHTTPURL, "mailto:paul", false);
	})

	t.test("data: URI", (t) => {
		function_test(t, isDataURI, "", false);
		function_test(t, isDataURI, "data:", false);
		function_test(t, isDataURI, "data:;base64", false);
		function_test(t, isDataURI, "data:;base64,", false);
		function_test(t, isDataURI, "data:;base64,iVBORw0KGgoAAAANSUhEUgAAAHIAAAAxCAYAAAAGEf2/AAAAAXNSR0IArs4c6QAAD9VJREFUeAHNXGlwHMUVft0zu+tDMgYbGyjCHQMxECqFIYnDaTBgsCFgyxIGB4wsySaEUAkVQlGFSH4kRTmAwYcsX5y2JO6QEBsoDEUMFQiBkBAw5r5sk+ADbKQ9pjvf65VWWu1Mz6xYSdul0cx0v+5+3e/1u7pnBc1tGUf9nbTaRZI8GjGqnRacvae/uytJ+/PbKki4B1AqVZLmChqJI6cjrWhYYhdRRZLunPJlAYwt4/LVI2nY8NE0ZsZ71CiUoPqWDht8acr0bhJCkRa403/R5nu4v0aKXqR4+jW689LiBlEapOyt1LfcTm68gTL9REhMAJFWmJfdeAANxMek9ask5DqS+llaUsX5/mluywQsjGtIxtrJS31Ew50FghpatT90KXMZaSSBu7lk9p5Jc+4HyFuHMd1HTTM3csagp9o1Y8mR/ybpjOa57t/UOTfSwZxgXrg/7b1JSiyi5O5VdNcVhQutrvUGEmpvVDgSi+M51HlRggtQsb8vRg6X8oi8DBkuTyezeUIcQtJtAFLPUUPbOjDWxP6duAitO7Ka3MRog+9AzY0Hps5gTvhO8mhy3cU0tOJJmtd2ZAHGQndgQbNw3oH7SHKdJFhgkBMTlwegtUOOezYG8QzNa72D6tr2GhTMLl89BP3WGiIOCgLoVDGzY06kezIY/Amau2Z8HiqefIQ0tVMs8T4J/QmN/c+rrCMHQLTmoWF/YdHrJsCZqZcpoy6l5dVv2yuUuHTe2mkkYo8ZyVHipvvUnIuF56UhaoedQs1T/5fXxtVPJGAkgeKgeV5BObywKEtDLUh3AkTGU1S/9oQBRcujOqOrQjtlfc+6vsjLGDmhjXcDsLHlJo4msefX3ZmdT51E5LfoK5IRdmMFbVkzzFpn/cv6sV", true);
		function_test(t, isDataURI, "data:image/png;base64,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", true);
		function_test(t, isDataURI, "data:image/png;base64,iVBORw0KG", true);
		function_test(t, isDataURI, "data:image/jpeg;base64,UEsDBBQAAAAI", true);
		function_test(t, isDataURI, "data:image/jpeg;key=value;base64,UEsDBBQAAAAI", true);
		function_test(t, isDataURI, "data:image/jpeg;key=value,UEsDBBQAAAAI", true);
		function_test(t, isDataURI, "data:;base64;sdfgsdfgsdfasdfa=s,UEsDBBQAAAAI", true);
		function_test(t, isDataURI, "data:,UEsDBBQAAAAI", true);
	})

	t.test("tag: URI", (t) => {
		function_test(t, isTAGURI, "", false);
		function_test(t, isTAGURI, "tag:sandt.com:uk,2023:SandT‑Service‑1", false);
		function_test(t, isTAGURI, "tag:sandt.com.uk,2023:SandT‑Service‑1", false);
		function_test(t, isTAGURI, "tag:sandt.com.uk,2023:SandT-Service-1", true);
		function_test(t, isTAGURI, "tag:sandt.com.uk,2023:SandT‑Service‑1‑The Legend of Boggy Creek (1972)", false);
		function_test(t, isTAGURI, "tag:sandt.com.uk,2023:SandT-Service-1-The%20Legend%20of%20Boggy%20Creek%20(1972)", true);
	})

	t.test("URNs", (t) => {
		function_test(t, isURN, "", false);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3-4", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3-4-5", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3-4-5-6", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3-4-5-6-7", true);
		function_test(t, isURN, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2-3-4-5-6-7-8", true);
		function_test(t, isURN, "urn:tva:metadata:cs:AudioPurposeCS:2007:6", true)
		function_test(t, isURN, "urn:dvb:metadata:cs:VideoConformancePointsCS:2017:1.1.3", true)
		function_test(t, isURN, "urn:tva:metadata:cs:SubtitleCarriageCS:2023:2", true)
		function_test(t, isURN, "urn:tva:metadata:cs:SubtitleCodingFormatCS:2023:2.1.3", true)
		function_test(t, isURN, "urn:tva:metadata:cs:SubtitlePurposeCS:2023:2", true)
		function_test(t, isURN, "urn:dvb:metadata:dvbi:servicediscovery:6", true)
		function_test(t, isURN, "urn:dvb:metadata:servicelistdiscovery:2026", true)
		function_test(t, isURN, "urn:dvb:metadata:servicediscovery:2026", true)
		function_test(t, isURN, "urn:tva:metadata:1999", true)
	})

	t.test("ISO Durations", (t) => {
		function_test(t, isISODuration, "", false);
		function_test(t, isISODuration, "PT1H", true);
		function_test(t, isISODuration, "PT1H00M00S", true);
		function_test(t, isISODuration, "PT45M", true);
		function_test(t, isISODuration, "PT1H16.3S", true);
		function_test(t, isISODuration, "+PT1H16.3S", true);
		function_test(t, isISODuration, "-PT1H16.3S", true);
		function_test(t, isISODuration, "P3Y6M4DT12H30M5S", true);
		function_test(t, isISODuration, "P-3Y6M4DT12H30M5S", true);
		function_test(t, isISODuration, "P3MT", false);
		function_test(t, isISODuration, "PT", false);
		function_test(t, isISODuration, "P", false);
		function_test(t, isISODuration, "P3DT", false);
	})

	t.test("Zulu times", (t) => {
		function_test(t, validZuluTimeType, "", false);
		function_test(t, validZuluTimeType, "24:00:00Z", false);
		function_test(t, validZuluTimeType, "09:30-05:00", false);
		function_test(t, validZuluTimeType, "09:30+08:30", false);
		function_test(t, validZuluTimeType, "09:30+12", false);
	})

	t.test("UTC times", (t) => {
		function_test(t, isUTCDateTime, "", false);
		function_test(t, isUTCDateTime, "2024-08-20T12:45:15.000Z", true);
		function_test(t, isUTCDateTime, "2024-08-20T12:45:15Z", true);
		function_test(t, isUTCDateTime, "2014-07-15T20:42:30Z", true);
	})

	t.test("UUID", (t) => {
		function_test(t, isUUIDformat, "", false);
		function_test(t, isUUIDformat, "3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", true);
		function_test(t, isUUIDformat, "3D5E6D35-9B9A-41E8-B843-DD3C6E72C42C", true);
		function_test(t, isUUIDformat, "bananass-food-cats-dogs-transformate", false);
		function_test(t, isUUIDformat, "ThisIsNotA UUID", false);
	})
})