# Test signing key and certificate

**For testing only. Never use them to sign anything real.** The private key is published here on purpose.

`test-signing.key` (an Ed25519 private key, PKCS#8 PEM) and `test-signing.crt` (its self-signed certificate) let `test-app.ts` sign test responses with a detached JWS in `X-JWS-Signature` (A177r8 clause 7.7.1.2). That way the response signature checks of `lib/jws_checks.mts` can be tested without the network (dvb-i-tools #134):

- the certificate goes in the JWS `x5c` header
- its SHA-256 fingerprint goes in the `CAFingerprint` of the test service list's `SignaturePolicy`

Node can sign with a key, but cannot create an X.509 certificate, so the pair is fixed. It was made with:

```sh
openssl req -x509 -newkey ed25519 -nodes -keyout test-signing.key -out test-signing.crt -days 36500 \
	-subj "/CN=dvb-i-tools test signing certificate/O=dvb-i-tools testsuite"
```

It is valid until November 2126. Its SHA-256 fingerprint is
`EE:5E:00:E9:2E:F8:25:FB:CB:6B:AD:10:4D:66:AE:F8:CD:CC:8B:D4:E6:3A:EA:11:9A:E3:B3:E5:77:86:C5:71`. The tests read the fingerprint from the certificate, so it does not need to be kept in step.
