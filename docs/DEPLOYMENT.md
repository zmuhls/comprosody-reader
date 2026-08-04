# Cadence private-service deployment

Cadence is designed to run as a **private Railway service** behind the existing
Readings application. The browser sees one origin and one product:

```text
Browser
  └─ https://<readings-host>/studio/*
       ├─ app and assets → Cadence private service /*
       └─ API requests   → Cadence private service /api/*
                            Authorization: Bearer <shared secret>
```

The Readings gateway owns public authentication and the `/studio` mount. Cadence
owns transcription, refinement, its production client bundle, and a second
service-to-service authentication boundary. Do not publish the Cadence Railway
service or expose its shared secret to the browser.

## Gateway contract

The production client sends API calls to `/studio/api` by default. Local Vite
development sends them to `/api`; `VITE_CADENCE_API_BASE_URL` can override that
base at build time.

Configure the Readings server to proxy `/studio/*` to the Cadence private
service and strip the leading `/studio` segment. The gateway must:

- forward request methods, query strings, raw audio bodies, `Content-Type`, and
  `X-Cadence-Keyterms`;
- add `Authorization: Bearer <COMPROSODY_API_KEY>` on server-side API requests;
- remove the browser `Origin` header before private-network forwarding so
  same-origin module and API requests are not rejected by Cadence CORS;
- stream `/api/refine` responses without buffering so server-sent events remain
  incremental;
- allow request bodies of at least 50 MB and upstream requests of at least 120
  seconds; and
- never forward the shared secret to client JavaScript, HTML, logs, or error
  bodies.

The resulting mappings are:

| Public Readings path | Private Cadence path |
| --- | --- |
| `/studio` and `/studio/*` | `/*` |
| `/studio/api/health` | `/api/health` |
| `/studio/api/transcribe` | `/api/transcribe` |
| `/studio/api/refine` | `/api/refine` |
| `/studio/api/refine/complete` | `/api/refine/complete` |
| `/studio/api/variants` | `/api/variants` |
| `/studio/api/speech/voices` | `/api/speech/voices` |
| `/studio/api/speech/synthesize` | `/api/speech/synthesize` |

`GET /api/health` is intentionally unauthenticated and returns only
`{"ok":true}`. Every functional API route remains protected when
`COMPROSODY_API_KEY` is set. Unknown `/api` routes return JSON `404` responses
instead of the SPA shell.

## Railway service

Create one service from this directory. Railway will discover `railway.json`
and build `Dockerfile`; no remote project is linked by files in this repository.
Keep the service on private networking and do not generate a public domain for
it.

Set these runtime variables on the Cadence service:

```dotenv
NODE_ENV=production
HOST=::
PORT=3001
COMPROSODY_API_KEY=<long random service secret>
ALLOWED_ORIGINS=https://<readings-public-domain>
```

Cadence listens on `PORT`. Set the service variable explicitly because Railway
cross-service references such as `${{cadence.PORT}}` resolve only variables
defined on that service; they do not infer the runtime port. Binding `HOST=::`
works with Railway's dual-stack private network. Add provider credentials only
for enabled operations:

```dotenv
OLLAMA_API_KEY=<server-side key>
OLLAMA_MODEL=qwen3.5:397b
OLLAMA_BASE_URL=https://ollama.com
ELEVENLABS_API_KEY=<server-side key>
ELEVENLABS_SCRIBE_MODEL=scribe_v2
TRANSCRIPTION_PROVIDER=elevenlabs
```

Only add newly rotated Ollama and ElevenLabs credentials through Railway's
secret variable input; never commit either credential or compile it into a
`VITE_` variable. `OLLAMA_MODEL` and `OLLAMA_BASE_URL` are non-secret
configuration; the service validates both before making a refinement request.
ElevenLabs is the practical hosted default. The image also includes
faster-whisper and FFmpeg, but a local Whisper model is downloaded into
ephemeral container storage and can create substantial cold-start, memory, and
CPU load. Use `TRANSCRIPTION_PROVIDER=local` on Railway only after profiling the
selected `FASTER_WHISPER_MODEL` against that service size.

On the Readings service, create the private upstream variables expected by its
gateway, preferably through Railway's service-variable reference UI:

```dotenv
CADENCE_SERVICE_URL=http://<cadence-private-domain>:<cadence-port>
CADENCE_SERVICE_TOKEN=<same secret as COMPROSODY_API_KEY>
```

Prefer Railway reference/shared variables over copying values. Service and
variable names are project-specific, so resolve the Cadence private domain and
port from the linked service rather than committing them.

## Build-time client override

No client variable is needed for the normal Readings deployment: production
builds default to `/studio/api`.

For a different reverse-proxy mount, set a non-secret build variable:

```dotenv
VITE_CADENCE_API_BASE_URL=/another-mount/api
```

This variable is compiled into the browser bundle. It may contain a path or
public origin, but it must never contain `COMPROSODY_API_KEY` or any provider
credential.

## Acceptance checks before routing traffic

From inside the Railway project network:

1. `GET <CADENCE_SERVICE_URL>/api/health` returns `200` without authorization.
2. A functional API request without authorization returns `401`.
3. The same request through the Readings gateway reaches Cadence with
   authorization injected server-side.
4. The `/studio` shell and a nested client route both return the built app.
5. A refinement response streams incrementally through the gateway.
6. A representative audio upload succeeds without the gateway truncating its
   body or timing out.

These checks establish the deployment boundary. Microphone permission and
recording still require a real browser on the final HTTPS Readings origin.
