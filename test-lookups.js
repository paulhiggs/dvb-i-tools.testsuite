import { test } from 'node:test';

import { KnownCASystemID, KnownDRMScheme } from "../lib/identifiers.mjs";

import { 
	LoadCountries, 
	LoadLanguages, 
	LoadVideoCodecCS, LoadVideoConformanceCS,
	LoadAudioCodecCS, LoadAudioConformanceCS, LoadAudioPresentationCS, LoadAudioPurpose,
	LoadGenres, 
	LoadAccessibilityPurpose,
	LoadSubtitleCarriages, LoadSubtitleCodings, LoadSubtitlePurposes,
	LoadRecordingInfoCS,
	LoadPictureFormatCS, LoadColorimetryCS,
	LoadServiceTypeCS, 
	LoadRatings, LoadCredits,
	LoadLinkedApplicationCS,
 } from "../lib/classification_scheme_loaders.mjs";

function function_test_hex(parentTest, fn, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "0x${input.toString(916)}"`);
	else
		parentTest.test(`"0x${input.toString(16)}"`, (t) => {
			t.assert.strictEqual(fn(input), expected);
		});
}

function function_test(parentTest, fn, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(fn(input), expected);
		});
}

test('Identifiers', (t) => {

	t.test("CASystemID", (t) => {
		function_test_hex(t, KnownCASystemID, 0, false);
		function_test_hex(t, KnownCASystemID, 0x098c, true);
	});

	t.test("DRMSystemID", (t) => {
		function_test(t, KnownDRMScheme, "", false)
		function_test(t, KnownDRMScheme, "3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", true)
		function_test(t, KnownDRMScheme, "urn:uuid:3d5e6d35-9b9a-41e8-b843-dd3c6e72c42c", true)
		function_test(t, KnownDRMScheme, "urn:uuid:22222222-bbbb-cccc-dddd-111111111111", false)
	})
})



function includes_test(parentTest, CS, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(CS.has(input), expected);
		});
}

function includes_leaf_test(parentTest, CS, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip leaf "${input}"`);
	else
		parentTest.test(`leaf "${input}"`, (t) => {
			t.assert.strictEqual(CS.isLeaf(input), expected);
		});
}


function language_lookup_test(parentTest, scheme, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(scheme.isKnown(input)?.resp, expected);
		});
}

function sign_language_lookup_test(parentTest, scheme, input, expected, skip = false) {
	if (skip)
		parentTest.skip(`skip "${input}"`);
	else
		parentTest.test(`"${input}"`, (t) => {
			t.assert.strictEqual(scheme.isKnownSignLanguage(input), expected);
		});
}

test('Classification Schemes', (t) => {

	const NOT_LOADED = "No values loaded", LOAD_FAILED = "Cannot load scheme";

	t.test("Countries", (t) => {
		t.test("2 character codes", (t) => {
			const c = LoadCountries({verbose: true, async: false}, false, true);
			if (c) {
				t.assert.notEqual(c.count(), 0, NOT_LOADED)

				includes_test(t, c, "NZ", false);
				includes_test(t, c, "NZL", true);
				includes_test(t, c, "AY", false);
				includes_test(t, c, "AYE", false);
			}
			else t.skip(LOAD_FAILED);
		})
		t.test("3 character codes", (t) => {
			const c = LoadCountries({verbose: false, async: false, useURLs: false}, true, false);
			if (c) {
				t.assert.notEqual(c.count(), 0, NOT_LOADED)

				includes_test(t, c, "AU", true);
				includes_test(t, c, "AUS", false);
				includes_test(t, c, "AY", false);
				includes_test(t, c, "AYE", false);
			}
			else t.skip(LOAD_FAILED);
		})
		t.test("2 and 3 characater codes", (t) => {
			const c = LoadCountries({verbose: true, async: false}, true, true);
			if (c) {
				t.assert.notEqual(c.count(), 0, NOT_LOADED)

				includes_test(t, c, "GB", true);
				includes_test(t, c, "GBR", true);
				includes_test(t, c, "AY", false);
				includes_test(t, c, "AYE", false);
			}
			else t.skip(LOAD_FAILED);
		})
	})

	
	t.test("Languages", (t) => {
		const l = LoadLanguages({verbose: false, async: false, useURLs: false});
		if (l) {
			t.assert.notEqual(l.count(), "lang=0,sign=0,redun=0", NOT_LOADED)

			language_lookup_test(t, l, "en", l.languageKnown)
			language_lookup_test(t, l, "aym", l.languageUnknown)

			language_lookup_test(t, l, "qaa", l.languageKnown) // start of qaa.qtz range
  		language_lookup_test(t, l, "qbc", l.languageKnown) // middle of qaa.qtz range
			language_lookup_test(t, l, "qtz", l.languageKnown) // end of qaa.qtz range

			sign_language_lookup_test(t, l, "fr", l.languageUnknown)
			sign_language_lookup_test(t, l, "gym", l.languageUnknown)

			language_lookup_test(t, l, "bfi", l.languageKnown)
			sign_language_lookup_test(t, l, "bfi", l.languageKnown)

			language_lookup_test(t, l, "ase", l.languageKnown)
			sign_language_lookup_test(t, l, "ase", l.languageKnown)

			t.test("clear()", (t) => {
				l.clear(); 
				t.assert.equal(l.count(), "lang=0,sign=0,redun=0", "not empty!")
			})
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Video Codecs", (t) => {
		const v = LoadVideoCodecCS({verbose: false, async: false, useURLs: false});
		if (v) {
			t.assert.notEqual(v.count(), 0, NOT_LOADED)

			const prefix = "urn:dvb:metadata:cs:VideoCodecCS"
			includes_test(t, v, `${prefix}:2007:1.1`, true);
			includes_leaf_test(t, v, `${prefix}:2007:1.1`, false);
			includes_test(t, v, `${prefix}:2007:2.x`, false);
			includes_leaf_test(t, v, `${prefix}:2007:2.1.2`, true);

			includes_test(t, v, `${prefix}:2020:1.6`, true);
			includes_leaf_test(t, v, `${prefix}:2020:1.6`, false);
			includes_test(t, v, `${prefix}:2020:2.x`, false);
			includes_leaf_test(t, v, `${prefix}:2020:1.6.4`, true);

			includes_test(t, v, `${prefix}:2021:2.3`, true);
			includes_leaf_test(t, v, `${prefix}:2021:2.3`, false);
			includes_test(t, v, `${prefix}:2021:3.x`, false);
			includes_leaf_test(t, v, `${prefix}:2021:4.2.19`, true);

			includes_test(t, v, `${prefix}:2022:6.1`, true);
			includes_leaf_test(t, v, `${prefix}:2022:6.1`, false);
			includes_test(t, v, `${prefix}:2022:4.x`, false);
			includes_leaf_test(t, v, `${prefix}:2022:5.1.20`, true);

			const MPEGprefix = "urn:mpeg:mpeg7:cs:VisualCodingFormatCS:2001"
			includes_test(t, v, `${MPEGprefix}:2.1`, true);
			includes_leaf_test(t, v,  `${MPEGprefix}:2.1`, false);
			includes_test(t, v,  `${MPEGprefix}:2.x`, false);
			includes_leaf_test(t, v,  `${MPEGprefix}:2.1.1`, true);
			
			t.test("clear()", (t) => {
				v.clear(); 
				t.assert.equal(v.count(), 0, "not empty!")
			})
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Audio Codecs", (t) => {
		const a = LoadAudioCodecCS({verbose: false, async: false, useURLs: false});
		if (a) {
			t.assert.notEqual(a.count(), 0, NOT_LOADED)

			const DVBprefix = "urn:dvb:metadata:cs:AudioCodecCS";
			includes_test(t, a, `${DVBprefix}:2007:1.1`, true);
			includes_leaf_test(t, a, `${DVBprefix}:2007:1.1`, false);
			includes_test(t, a, `${DVBprefix}:2007:2.x`, false);
			includes_leaf_test(t, a, `${DVBprefix}:2007:2.1`, true);

			includes_test(t, a, `${DVBprefix}:2020:2`, true);
			includes_leaf_test(t, a, `${DVBprefix}:2020:2`, false);
			includes_test(t, a, `${DVBprefix}:2020:4.x`, false);
			includes_leaf_test(t, a, `${DVBprefix}:2020:5.1.2`, true);

			includes_test(t, a, `${DVBprefix}:2024:5.2`, true);
			includes_leaf_test(t, a, `${DVBprefix}:2024:5.2`, false);
			includes_test(t, a, `${DVBprefix}:2024:6.x.y`, false);
			includes_leaf_test(t, a, `${DVBprefix}:2024:7.2.3`, true);

			const MPEGprefix = "urn:mpeg:mpeg7:cs:AudioCodingFormatCS:2001"
			includes_test(t, a, `${MPEGprefix}:4.2`, true);
			includes_leaf_test(t, a, `${MPEGprefix}:4.2`, false);
			includes_test(t, a, `${MPEGprefix}:4.x`, false);
			includes_leaf_test(t, a, `${MPEGprefix}:5.8.6`, true);
			
			t.test("clear()", (t) => {
				a.clear(); 
				t.assert.equal(a.count(), 0, "not empty!")
			})
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Genres", (t) => {
		const g = LoadGenres({verbose: false, async: false, useURLs: false});
		if (g) {
			t.assert.notEqual(g.count(), 0, NOT_LOADED)

			includes_test(t, g, "urn:tva:metadata:cs:ContentCS:2011:3.7.1.5", true);
			includes_test(t, g, "urn:tva:metadata:cs:FormatCS:2011:2.7.3.11", true);
			includes_test(t, g, "urn:dvb:metadata:cs:ContentSubject:2019:1.0", true);
			includes_test(t, g, "urn:dvb:metadata:cs:ContentSubject:2019:9.7", true);
			includes_test(t, g, "urn:dvb:metadata:cs:ContentSubject:2019:12.0", true);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Accessibility Purpose", (t) => {
		const a = LoadAccessibilityPurpose({verbose: false, async: false, useURLs: false});
		if (a) {
			t.assert.notEqual(a.count(), 0, NOT_LOADED)

			const CS = "urn:tva:metadata:cs:AccessibilityPurposeCS:2023"
			includes_test(t, a, `${CS}:1.2`, true);
			includes_test(t, a, `${CS}:1`, true);
			includes_test(t, a, `${CS}:3.4`, true);
			includes_test(t, a, `${CS}:987`, false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Audio Purpose", (t) => {
		const a = LoadAudioPurpose({verbose: false, async: false, useURLs: false});
		if (a) {
			t.assert.notEqual(a.count(), 0, NOT_LOADED)

			includes_test(t, a, "urn:tva:metadata:cs:AudioPurposeCS:2007:1", true);
			includes_test(t, a, "urn:tva:metadata:cs:AudioPurposeCS:2007:9", true);
			includes_test(t, a, "urn:tva:metadata:cs:AudioPurposeCS:2007:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Subtitle Carriage", (t) => {
		const s = LoadSubtitleCarriages({verbose: false, async: false, useURLs: false});
		if (s) {
			t.assert.notEqual(s.count(), 0, NOT_LOADED)

			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCarriageCS:2023:1", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCarriageCS:2023:99", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCarriageCS:2023:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Subtitle Coding", (t) => {
		const s = LoadSubtitleCodings({verbose: false, async: false, useURLs: false});
		if (s) {
			t.assert.notEqual(s.count(), 0, NOT_LOADED)

			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCodingFormatCS:2023:2.1.4", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCodingFormatCS:2023:3.6.1.3", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitleCodingFormatCS:2023:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Subtitle Coding", (t) => {
		const s = LoadSubtitlePurposes({verbose: false, async: false, useURLs: false});
		if (s) {
			t.assert.notEqual(s.count(), 0, NOT_LOADED)

			includes_test(t, s, "urn:tva:metadata:cs:SubtitlePurposeCS:2023:1", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitlePurposeCS:2023:5", true);
			includes_test(t, s, "urn:tva:metadata:cs:SubtitlePurposeCS:2023:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Audio Conformance", (t) => {
		const a = LoadAudioConformanceCS({verbose: false, async: false, useURLs: false});
		if (a) {
			t.assert.notEqual(a.count(), 0, NOT_LOADED)

			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2017:1.1.7", true);
			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2017:2.2", true);
			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2017:987", false);

			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2024:1.2.8", true);
			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2024:2.2", true);
			includes_test(t, a, "urn:dvb:metadata:cs:AudioConformancePointsCS:2024:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Video Conformance", (t) => {
		const v = LoadVideoConformanceCS({verbose: false, async: false, useURLs: false});
		if (v) {
			t.assert.notEqual(v.count(), 0, NOT_LOADED)

			const CS =  "urn:dvb:metadata:cs:VideoConformancePointsCS"
			includes_test(t, v, `${CS}:2017:2.2.2`, true);
			includes_test(t, v, `${CS}:2017:999.999.999`, false);

			includes_test(t, v, `${CS}:2021:1.1.14`, true);
			includes_test(t, v, `${CS}:2021:999.999.999`, false);
		
			includes_test(t, v, `${CS}:2022:2.1.18`, true);
			includes_test(t, v, `${CS}:2022:2.1.22`, true);
			includes_test(t, v, `${CS}:2022:999.999.999`, false);

			includes_test(t, v, `${CS}:2024:2.3.3`, true);
			includes_test(t, v, `${CS}:2024:2.3`, true);
			includes_test(t, v, `${CS}:2024:999.999.999`, false);
		}
		else t.skip(LOAD_FAILED);
	})

	
	t.test("Audio Presentation", (t) => {
		const a = LoadAudioPresentationCS({verbose: false, async: false, useURLs: false});
		if (a) {
			t.assert.notEqual(a.count(), 0, NOT_LOADED)

			includes_test(t, a, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:1", true);
			includes_test(t, a, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:6", true);
			includes_test(t, a, "urn:mpeg:mpeg7:cs:AudioPresentationCS:2001:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Recording Info", (t) => {
		const r = LoadRecordingInfoCS({verbose: false, async: false, useURLs: false});
		if (r) {
			t.assert.notEqual(r.count(), 0, NOT_LOADED)

			includes_test(t, r, "urn:dvb:metadata:cs:RecordingInfoCS:2019:1", true);
			includes_test(t, r, "urn:dvb:metadata:cs:RecordingInfoCS:2019:5", true);
			includes_test(t, r, "urn:dvb:metadata:cs:RecordingInfoCS:2019:987", false);
		}
		else t.skip(LOAD_FAILED);
	})

	
	t.test("Recording Info", (t) => {
		const p = LoadPictureFormatCS({verbose: false, async: false, useURLs: false});
		if (p) {
			t.assert.notEqual(p.count(), 0, NOT_LOADED)

			includes_test(t, p, "urn:tva:metadata:cs:PictureFormatCS:2015:1.4.2", true);
			includes_test(t, p, "urn:tva:metadata:cs:PictureFormatCS:2015:4.1", true);
			includes_test(t, p, "urn:tva:metadata:cs:PictureFormatCS:2015:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Colorimetry", (t) => {
		const c = LoadColorimetryCS({verbose: false, async: false, useURLs: false});
		if (c) {
			t.assert.notEqual(c.count(), 0, NOT_LOADED)

			includes_test(t, c, "urn:dvb:metadata:cs:ColorimetryCS:2020:2.1", true);
			includes_test(t, c, "urn:dvb:metadata:cs:ColorimetryCS:2020:3.1", true);
			includes_test(t, c, "urn:dvb:metadata:cs:ColorimetryCS:2020:987", false);
		}
		else t.skip(LOAD_FAILED);
	})
	

	t.test("Service Type", (t) => {
		const s = LoadServiceTypeCS({verbose: false, async: false, useURLs: false});
		if (s) {
			t.assert.notEqual(s.count(), 0, NOT_LOADED)

			includes_test(t, s, "urn:dvb:metadata:cs:ServiceTypeCS:2019:linear", true);
			includes_test(t, s, "urn:dvb:metadata:cs:ServiceTypeCS:2019:other", true);
			includes_test(t, s, "urn:dvb:metadata:cs:ServiceTypeCS:2019:987", false);
		}
		else t.skip(LOAD_FAILED);
	})


	t.test("Ratings", (t) => {
		const r = LoadRatings({verbose: false, async: false, useURLs: false});
		if (r) {
			t.assert.notEqual(r.count(), 0, NOT_LOADED)

			includes_test(t, r, "urn:tva:metadata:cs:ContentAlertCS:2005:6.1.5.3", true);
			includes_test(t, r, "urn:tva:metadata:cs:ContentAlertCS:2005:6.10.2.3", true);
			includes_test(t, r, "urn:tva:metadata:cs:ContentAlertCS:2005:987", false);

			includes_test(t, r, "urn:dvb:metadata:cs:ParentalGuidanceCS:2007:1", true);
			includes_test(t, r, "urn:dvb:metadata:cs:ParentalGuidanceCS:2007:21.1.5", true);
			includes_test(t, r, "urn:dvb:metadata:cs:ParentalGuidanceCS:2007:987", false);

			t.test("clear()", (t) => {
				r.clear(); 
				t.assert.equal(r.count(), 0, "not empty!")
			})
		}
		else t.skip(LOAD_FAILED);
	})

	
	t.test("Credits", (t) => {
		const c = LoadCredits({verbose: false, async: false, useURLs: false});
		if (c) {
			t.assert.notEqual(c.count(), 0, NOT_LOADED)

			includes_test(t, c, "urn:mpeg:mpeg7:cs:RoleCS:2001:ACTOR", true);
			includes_test(t, c, "urn:tva:metadata:cs:TVARoleCS:2010:V813", true);
			includes_test(t, c, "urn:mpeg:mpeg7:cs:RoleCS:2001:AGGREGATOR", true);
			includes_test(t, c, "urn:tva:metadata:cs:TVARoleCS:2011:V813", true);
		}
		else t.skip(LOAD_FAILED);
	})

	
	t.test("Linked Application", (t) => {
		const l = LoadLinkedApplicationCS({verbose: false, async: false, useURLs: false});
		if (l) {
			t.assert.notEqual(l.count(), 0, NOT_LOADED)

			includes_test(t, l, "urn:dvb:metadata:cs:LinkedApplicationCS:2019:1.1", true);
			includes_test(t, l, "urn:dvb:metadata:cs:LinkedApplicationCS:2019:4.3", true);
			includes_test(t, l, "urn:dvb:metadata:cs:LinkedApplicationCS:2019:987", false);
		}
		else t.skip(LOAD_FAILED);
	})
})

