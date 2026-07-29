// test regular expressions

import { doTest } from "./expression_test_common.mjs";

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
} from "../../../lib/pattern_checks.mjs";

import { isTAGURI } from "../../../lib/pattern_checks.mjs";

const AVCregex = /[a-z0-9!"#$%&'()*+,./:;<=>?@[\] ^_`{|}~-]{4}\.[a-f0-9]{6}/i;
const AC4regex = /ac-4(\.[a-fA-F\d]{1,2}){3}/;
const VP9regex = /^vp09(\.\d{2}){3}(\.(\d{2})?){0,5}$/;
const AV1regex = /^av01\.\d\.\d+[MH]\.\d{1,2}((\.\d?)(\.(\d{3})?(\.(\d{2})?(.(\d{2})?(.(\d{2})?(.\d?)?)?)?)?)?)?$/;

const tests0 = [
	{ item: "v6-001", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7:8", expect: true },
	{ item: "v6-002", pattern: e_IPv6Address, evaluate: "1::", expect: true },
	{ item: "v6-003", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7::", expect: true },
	{ item: "v6-004", pattern: e_IPv6Address, evaluate: "1::8", expect: true },
	{ item: "v6-005", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6::8", expect: true },
	{ item: "v6-006", pattern: e_IPv6Address, evaluate: "1::7:8", expect: true },
	{ item: "v6-007", pattern: e_IPv6Address, evaluate: "1:2:3:4:5::7:8", expect: true },
	{ item: "v6-008", pattern: e_IPv6Address, evaluate: "1:2:3:4:5::8", expect: true },
	{ item: "v6-009", pattern: e_IPv6Address, evaluate: "1::6:7:8", expect: true },
	{ item: "v6-010", pattern: e_IPv6Address, evaluate: "1:2:3:4::6:7:8", expect: true },
	{ item: "v6-011", pattern: e_IPv6Address, evaluate: "1:2:3:4::8", expect: true },
	{ item: "v6-012", pattern: e_IPv6Address, evaluate: "1::5:6:7:8", expect: true },
	{ item: "v6-013", pattern: e_IPv6Address, evaluate: "1:2:3::5:6:7:8", expect: true },
	{ item: "v6-014", pattern: e_IPv6Address, evaluate: "1:2:3::8", expect: true },
	{ item: "v6-015", pattern: e_IPv6Address, evaluate: "1::4:5:6:7:8", expect: true },
	{ item: "v6-016", pattern: e_IPv6Address, evaluate: "1:2::4:5:6:7:8", expect: true },
	{ item: "v6-017", pattern: e_IPv6Address, evaluate: "1:2::8", expect: true },
	{ item: "v6-018", pattern: e_IPv6Address, evaluate: "1::3:4:5:6:7:8", expect: true },
	{ item: "v6-019", pattern: e_IPv6Address, evaluate: "1::8", expect: true },
	{ item: "v6-020", pattern: e_IPv6Address, evaluate: "::2:3:4:5:6:7:8", expect: true },
	{ item: "v6-021", pattern: e_IPv6Address, evaluate: "::8", expect: true },
	{ item: "v6-021", pattern: e_IPv6Address, evaluate: "::", expect: true },
	{ item: "v6-022", pattern: e_IPv6Address, evaluate: "fe08::7:8%eth0", expect: true },
	{ item: "v6-023", pattern: e_IPv6Address, evaluate: "fe08::7:8%1", expect: true },
	{ item: "v6-024", pattern: e_IPv6Address, evaluate: "::255.255.255.255", expect: true },
	{ item: "v6-025", pattern: e_IPv6Address, evaluate: "::ffff:255.255.255.255", expect: true },
	{ item: "v6-026", pattern: e_IPv6Address, evaluate: "2001:db8:3:4::192.0.2.33", expect: true },
	{ item: "v6-027", pattern: e_IPv6Address, evaluate: "64:ff9b::192.0.2.3", expect: true },

	{ item: "v6-028", pattern: e_IPv6Address, evaluate: "::ffff:10.0.0.1", expect: true },
	{ item: "v6-029", pattern: e_IPv6Address, evaluate: "::ffff:1.2.3.4", expect: true },
	{ item: "v6-030", pattern: e_IPv6Address, evaluate: "::ffff:0.0.0.0", expect: true },
	{ item: "v6-031", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:77:88", expect: true },
	{ item: "v6-032", pattern: e_IPv6Address, evaluate: "fe08::7:8", expect: true },
	{ item: "v6-033", pattern: e_IPv6Address, evaluate: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", expect: true },

	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "::ffff:0:255.255.255.255", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7:8:9", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6::7:8", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: ":1:2:3:4:5:6:7:8", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7:8:", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "::1:2:3:4:5:6:7:8", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7:8::", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "1:2:3:4:5:6:7:88888", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "2001:db8:3:4:5::192.0.2.33", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "fe08::7:8%", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "fe08::7:8i", expect: false },
	{ item: "v6-101", pattern: e_IPv6Address, evaluate: "fe08::7:8interface", expect: false },

	{ item: "v4-001", pattern: e_IPv4Address, evaluate: "1:2:3:4:5:6:7:8", expect: false },
	{ item: "v4-002", pattern: e_IPv4Address, evaluate: "64:ff9b::192.0.2.3", expect: false },
	{ item: "v4-003", pattern: e_IPv4Address, evaluate: "192.0.2.3", expect: true },
	{ item: "v4-004", pattern: e_IPv4Address, evaluate: "192..2.3", expect: false },
	{ item: "v4-005", pattern: e_IPv4Address, evaluate: "192.0", expect: false },
	{ item: "v4-006", pattern: e_IPv4Address, evaluate: "127.0.0.1", expect: true },
	{ item: "v4-007", pattern: e_IPv4Address, evaluate: "292.168.0.1", expect: false },
	{ item: "v4-008", pattern: e_IPv4Address, evaluate: "10002.3.4", expect: false },
	{ item: "v4-009", pattern: e_IPv4Address, evaluate: "1.2.3.4.5", expect: false },
	{ item: "v4-010", pattern: e_IPv4Address, evaluate: "256.0.0.0", expect: false },
	{ item: "v4-011", pattern: e_IPv4Address, evaluate: "260.0.0.0", expect: false },
	{ item: "v4-012", pattern: e_IPv4Address, evaluate: "10.0.0.1", expect: true },
	{ item: "v4-013", pattern: e_IPv4Address, evaluate: "192.168.1.1", expect: true },
	{ item: "v4-014", pattern: e_IPv4Address, evaluate: "0.0.0.0", expect: true },
	{ item: "v4-015", pattern: e_IPv4Address, evaluate: "255.255.255.255", expect: true },

	{ item: "dvbloc-01", fn: isDVBLocator, evaluate: "dvb://aa.bb.cc", expect: false },
	{ item: "dvbloc-01", fn: isDVBLocator, evaluate: "dvb://a0a.1bb.cc2;12d", expect: true },

	{ item: "post-01", fn: isPostcode, evaluate: "RG4 5HJ", expect: true },
	{ item: "post-02", fn: isPostcode, evaluate: "rg4-5hj", expect: true },
	{ item: "post-03", fn: isPostcode, evaluate: "RG4.5HJ", expect: false },
	{ item: "post-04", fn: isPostcode, evaluate: "30324", expect: true },
	{ item: "post-05", fn: isPostcode, evaluate: "90210", expect: true },

	{ item: "post-11", fn: isWildcardPostcode, evaluate: "W12 7TQ", expect: false },
	{ item: "post-12", fn: isWildcardPostcode, evaluate: "W12-7TQ", expect: false },
	{ item: "post-13", fn: isWildcardPostcode, evaluate: "*12-7TQ", expect: true },
	{ item: "post-14", fn: isWildcardPostcode, evaluate: "W12-*", expect: true },
	{ item: "post-15", fn: isWildcardPostcode, evaluate: "300*", expect: true },
	{ item: "post-16", fn: isWildcardPostcode, evaluate: "9*0", expect: true },
	{ item: "post-17", fn: isWildcardPostcode, evaluate: "9**0", expect: false },
	{ item: "post-18", fn: isWildcardPostcode, evaluate: "9*-*0", expect: false },

	{ item: "extn-11", fn: validExtensionName, evaluate: "HBBTV", expect: true },
	{ item: "extn-12", fn: validExtensionName, evaluate: "DVB-HB", expect: true },
	{ item: "extn-13", fn: validExtensionName, evaluate: "HBB.TV", expect: true },
	{ item: "extn-14", fn: validExtensionName, evaluate: "@HBBTV", expect: false },

	{ item: "fr-11", fn: validFrameRate, evaluate: "120", expect: true },
	{ item: "fr-12", fn: validFrameRate, evaluate: "59.96", expect: true },
	{ item: "fr-13", fn: validFrameRate, evaluate: "120/1.001", expect: true },

	{ item: "url-01", fn: isURL, evaluate: "http://github.com/", expect: true },
	{ item: "url-02", fn: isURL, evaluate: "https://github.com/", expect: true },
	{ item: "url-03", fn: isURL, evaluate: "mailto:someone@mycompany.com", expect: true },
	{ item: "url-04a", fn: isURL, evaluate: "mailto:someone@yoursite.com?subject=Mail from Our Site", expect: false },
	{ item: "url-04b", fn: isURL, evaluate: "mailto:someone@yoursite.com?subject=Mail%20from%20Our%20Site", expect: true },
	{
		item: "url-05a",
		fn: isURL,
		evaluate: "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News",
		expect: false,
	},
	{
		item: "url-05b",
		fn: isURL,
		evaluate: "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News",
		expect: true,
	},
	{
		item: "url-06a",
		fn: isURL,
		evaluate: "mailto:someone@yoursite.com?cc=someoneelse@theirsite.com, another@thatsite.com, me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here",
		expect: false,
	},
	{
		item: "url-06b",
		fn: isURL,
		evaluate:
			"mailto:someone@yoursite.com?cc=someoneelse@theirsite.com,%20another@thatsite.com,%20me@mysite.com&bcc=lastperson@theirsite.com&subject=Big%20News&body=Body-goes-here",
		expect: true,
	},

	{ item: "http-01", fn: isHTTPURL, evaluate: "http://github.com/", expect: true },
	{ item: "http-02", fn: isHTTPURL, evaluate: "https://github.com/", expect: true },
	{ item: "http-03", fn: isHTTPURL, evaluate: "http://where.co.uk/dvb-i/serviceList.php?id=331", expect: true },
	{ item: "http-04", fn: isHTTPURL, evaluate: "https://where.co.uk/dvb-i/serviceList.php?id=331", expect: true },
	{ item: "http-05", fn: isHTTPURL, evaluate: "mailto:paul", expect: false},

	{ item: "data-01", fn: isDataURI, evaluate: "data:image/png;base64,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", expect: true},
	{ item: "data-02a", fn: isDataURI, evaluate: "data:image/png;base64,iVBORw0KG", expect: true},
	{ item: "data-02b", fn: isDataURI, evaluate: "data:image/png;base64,iVBORw0KG", expect: true},
	{ item: "data-02c", fn: isDataURI, evaluate: "data:image/png;base64,iVBORw0KG", expect: true},
	{ item: "data-03", fn: isDataURI, evaluate: "data:image/jpeg;base64,UEsDBBQAAAAI", expect: true},
	{ item: "data-04", fn: isDataURI, evaluate: "data:image/jpeg;key=value;base64,UEsDBBQAAAAI", expect: true},
	{ item: "data-05", fn: isDataURI, evaluate: "data:image/jpeg;key=value,UEsDBBQAAAAI", expect: true},
	{ item: "data-06", fn: isDataURI, evaluate: "data:;base64;sdfgsdfgsdfasdfa=s,UEsDBBQAAAAI", expect: true},
	{ item: "data-07", fn: isDataURI, evaluate: "data:,UEsDBBQAAAAI", expect: true},

	{ item: "urn-01", fn: isURN, evaluate: "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:2", expect: true },

	{ item: "dur-01", fn: isISODuration, evaluate: "PT1H", expect: true },
	{ item: "dur-02", fn: isISODuration, evaluate: "PT1H00M00S", expect: true },
	{ item: "dur-03", fn: isISODuration, evaluate: "PT45M", expect: true },
	{ item: "dur-04", fn: isISODuration, evaluate: "PT1H16.3S", expect: true },
	{ item: "dur-05", fn: isISODuration, evaluate: "+PT1H16.3S", expect: true },
	{ item: "dur-06", fn: isISODuration, evaluate: "-PT1H16.3S", expect: true },
	{ item: "dur-07", fn: isISODuration, evaluate: "P3Y6M4DT12H30M5S", expect: true },
	{ item: "dur-08", fn: isISODuration, evaluate: "P+3Y6M4DT12H30M5S", expect: true },
	{ item: "dur-09", fn: isISODuration, evaluate: "P-3Y6M4DT12H30M5S", expect: true },

	{ item: "dur-30", fn: isISODuration, evaluate: "P3MT", expect: false },
	{ item: "dur-31", fn: isISODuration, evaluate: "PT", expect: false },
	{ item: "dur-32", fn: isISODuration, evaluate: "P", expect: false },
	{ item: "dur-33", fn: isISODuration, evaluate: "P3MT", expect: false },

	{ item: "ztime-01", fn: validZuluTimeType, evaluate: "09:30Z", expect: false }, // seconds are required in DVB-I
	{ item: "ztime-02", fn: validZuluTimeType, evaluate: "14:55:15Z", expect: true },
	{ item: "ztime-03", fn: validZuluTimeType, evaluate: "14:55:15.124Z", expect: true },

	{ item: "ztime-51", fn: validZuluTimeType, evaluate: "24:00:00Z", expect: false },
	{ item: "ztime-52", fn: validZuluTimeType, evaluate: "09:30-05:00", expect: false },
	{ item: "ztime-53", fn: validZuluTimeType, evaluate: "09:30+08:30", expect: false },
	{ item: "ztime-54", fn: validZuluTimeType, evaluate: "09:30+12", expect: false },

	{ item: "ztime-55", fn: isUTCDateTime, evaluate: "2024-08-20T12:45:15.000Z", expect: true },
	{ item: "ztime-56", fn: isUTCDateTime, evaluate: "2024-08-20T12:45:15Z", expect: true },
	{ item: "ztime-57", fn: isUTCDateTime, evaluate: "2014-07-15T20:42:30Z", expect: true },

	{ item: "taguri-1", fn: isTAGURI, evaluate: "tag:sandt.com:uk,2023:SandT‑Service‑1", expect: false },
	{ item: "taguri-2", fn: isTAGURI, evaluate: "tag:sandt.com.uk,2023:SandT‑Service‑1", expect: false },
	{ item: "taguri-3", fn: isTAGURI, evaluate: "tag:sandt.com.uk,2023:SandT-Service-1", expect: true },
	{ item: "taguri-4", fn: isTAGURI, evaluate: "tag:sandt.com.uk,2023:SandT‑Service‑1‑The Legend of Boggy Creek (1972)", expect: false },
	{ item: "taguri-5", fn: isTAGURI, evaluate: "tag:sandt.com.uk,2023:SandT-Service-1-The%20Legend%20of%20Boggy%20Creek%20(1972)", expect: true },

	{ item: "uuid-1", fn: isUUIDformat, evaluate: "3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", expect: true },
  { item: "uuid-2", fn: isUUIDformat, evaluate: "3D5E6D35-9B9A-41E8-B843-DD3C6E72C42C", expect: true },
	{ item: "uuid-3", fn: isUUIDformat, evaluate: "bananass-food-cats-dogs-transformate", expect: false },
	{ item: "uuid-4", fn: isUUIDformat, evaluate: "ThisIsNotA UUID", expect: false },
];

const tests1 = [
	{ item: "AVC regexp1", expression: AVCregex, evaluate: "avc1.001122", expect: true },
	{ item: "AC-4 regexp1", expression: AC4regex, evaluate: "ac-4.00.11.22", expect: true },
	{ item: "VP9 regex1", expression: VP9regex, evaluate: "vp09.00.11.22", expect: true },
	{ item: "VP9 regex2", expression: VP9regex, evaluate: "vp09.00.11.22..12.03..", expect: true },
	{ item: "AV1 regex1", expression: AV1regex, evaluate: "av01.0.04M.10.0.112.09.16.09.0", expect: true },
	{ item: "AV1 regex2", expression: AV1regex, evaluate: "av01.0.04M.12", expect: true },
	{ item: "AV1 regex3", expression: AV1regex, evaluate: "av01.0.04H.8..112....0", expect: true },
];

tests0.forEach((test) => doTest(test));
tests1.forEach((test) => doTest(test));
