# Test TLS server certificates

**For testing only. Never use them for a real server.** The private keys are published here on purpose.

`test-app.ts` runs local HTTPS servers with these certificates. That way the connection certificate checks of `lib/tls_checks.mts` can be tested without the network (dvb-i-tools #134). Both are self-signed EC P-256 certificates for `127.0.0.1`:

| Files | Valid | Used for |
|---|---|---|
| `test-server.key`, `test-server.crt` | November 2026 to November 2126 | a valid chain. Its SHA-256 fingerprint is the `CAFingerprint` of the test policy |
| `test-expired.key`, `test-expired.crt` | 1 January 2020 to 1 January 2021 | an expired certificate (TLS003) |

The validator reads a server's certificate chain without rejecting an untrusted certificate, so that it can report on it. For an IP address there is no host name to check. The tests read the fingerprints from the certificates.

They were made with (OpenSSL 3.5; under Git Bash on Windows set `MSYS2_ARG_CONV_EXCL="*"`, or the subjects are converted to paths):

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout test-server.key -out test-server.crt \
	-days 36500 -subj "/CN=127.0.0.1/O=dvb-i-tools testsuite" -addext "subjectAltName=IP:127.0.0.1"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout test-expired.key -out test-expired.crt \
	-not_before 20200101000000Z -not_after 20210101000000Z -subj "/CN=127.0.0.1/O=dvb-i-tools testsuite (expired)" \
	-addext "subjectAltName=IP:127.0.0.1"
```
