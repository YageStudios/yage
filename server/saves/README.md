# YAGE family save API — phase 1

This adds durable family careers, private person collection profiles and offline-copy slots to the existing YAGE Socket.IO relay process. It does not run game simulation, sessions, room authority, accounts, subscriptions or anti-cheat. A localhost service is deployed on the owner's workstation; see [the operating runbook](../../docs/local-save-server.md). No external endpoint is deployed. The game persistence workstream has added boot/autosave adapter wiring. Its native boot acceptance remains a separate pending gate; the supplied library's actual Socket.IO round trip is tested independently.

From the YAGE repository, install with `npm ci`, then run `npm run test:save-api`. This dedicated Node suite is named `*.node.mjs` to stay outside Vitest discovery. It enforces at least 80% aggregate line, branch and function coverage for the save modules. Use Node 24 or later: the process loads the existing TypeScript relay through Node's native type stripping, without downloading a runtime transpiler.

Start one process with a private operator credential of at least 24 characters:

```sh
export YAGE_SAVE_OPERATOR_CREDENTIAL="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
export YAGE_SAVE_DIR=/absolute/private/save-data
npm run server:saves
```

The default bind address is `127.0.0.1`, port 3001. Set `HOST` and `PORT` when hosting. For an external endpoint, put the process behind an HTTPS/WSS reverse proxy and keep the operator credential on the server/parent administration device. Do not put it in a shipped game bundle. Every save operation requires the correct operator, family parent or member credential; relay membership grants no save permission. Save messages are excluded from relay logs, history and broadcasts. The existing relay/status endpoints retain their original behavior and are not an account/session service.

`createFamily` returns random parent/member credentials once. Store these privately; only hashes go to disk. Give a captain its member credential, which can read/write its family careers and its own collection profile. Parent credentials create members and can delete careers, list/promote offline slots and manage family profiles. Member names and avatar IDs are parent chosen; up to eight members are supported. Phase 1 does not provide account recovery or credential rotation. Losing parent credentials requires restoring them from the parent's private credential backup; the operator token cannot impersonate an existing family.

## Wire contract

Emit `save:request` with `{ action, input }` and a Socket.IO acknowledgement callback. Responses are `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. No game data is inferred or merged. Documents are JSON objects, at most 1 MiB. The optional synchronous `validators[gameId](doc, version)` hook rejects invalid game documents; wire it through `startSaveServer({ validators })`. Profiles use their own collection schema and bypass career validators.

| Action | Input and permission |
|---|---|
| `createFamily` | `operatorCredential`; returns family ID, parent person ID and parent/member credentials |
| `createMember` | `familyId`, parent `credential`, `displayName`, `avatar`; returns person ID and its member credential |
| `listCareers` | `familyId`, family `credential`; returns metadata without full documents |
| `getCareer` | `careerId`, family `credential`; returns complete record |
| `putCareer` | New: `familyId`, `gameId`, optional stable `careerId`, `version`, `doc`, `seq: 0`, family `credential`. Update: `careerId`, `version`, `doc`, expected prior server `seq`, family `credential` |
| `deleteCareer` | `careerId`, parent `credential`; removes career/slots/upload receipts, retains personal profiles |
| `putOfflineCopy` | `careerId`, family `credential`, `version`, `doc`, `baseSeq`, stable `offlineSessionId`, short device/date/milestone `label` |
| `listSlots` | `careerId`, parent `credential` |
| `promoteSlot` | `careerId`, `slotId`, expected prior server `seq`, parent `credential`; swaps main and slot, retaining previous main |
| `getProfile` | `familyId`, `gameId`, `personId`, that person's member or parent `credential` |
| `putProfile` | Same identity/credential plus expected prior profile `seq` (0 if absent), `doc: { cosmetics: string[], postcards: string[], achievements: string[], learningRef?: string }`; duplicate IDs and learning logs rejected |

Career records are `{ gameId, careerId, familyId, version, seq, checksum, doc, updatedAt }`. The record checksum is SHA-256 of the JSON blob, independent of the game's checksum inside that blob. CAS is serialized with the durable write: two requests with one expected sequence produce one winner. Deleted or changed careers return error values. A lost acknowledgement can mean the write succeeded; fetch current remote state before deciding to retry or submit an offline copy.

`client.mjs` exports `createSaveSocket(url)` using the existing Socket.IO client dependency and browser-safe `putCareerDocument(socket, { familyId, gameId, credential, serverSeq }, document)`. A client-supplied `document.careerId` remains the remote record ID. The document's own `seq`, `baseSeq`, `checksum` and version stay untouched. `serverSeq` is separate remote lineage: start at 0 for creation, then retain the acknowledged record sequence for the next put. Local A/B writes can increase the document sequence many times while offline; they do not claim server CAS sequence numbers. Do not silently rewrite an internal checksum to match the server envelope.

Offline uploads with `baseSeq` equal to the main remote sequence fast-forward once. Diverged uploads leave main unchanged and create a promotable slot. `offlineSessionId` deduplicates retries; changing content under a used ID returns `offline_conflict`. A base sequence ahead of the server is invalid. Parent promotion never merges documents. Personal profiles are independent of career swaps and require their own CAS writes.

## Storage, daily backups and restore drill

Use **one process and one local data directory**, on a filesystem supporting atomic rename and file/directory fsync. This is not a multi-process/distributed database. A PID writer lock rejects simultaneous server or restore processes. A verified dead process lock is cleared at restart. Container PID namespaces must not share one live data volume between containers. Do not manually remove a live writer lock.

Each accepted transaction writes a private temporary file, fsyncs it, renames it to `saves.json` and fsyncs the directory before acknowledgement. Three prior checksum-verified database snapshots are retained. The database includes career, person-profile and credential-hash tables. A corrupt main falls back to the newest valid retained backup and reports recovery; if none is valid, startup fails. Retained versions are not a substitute for daily archives on separate storage. A directory-sync failure can leave an unacknowledged committed write; fetching the current sequence resolves this uncertainty.

The backup command reads one complete atomic snapshot while the server continues running. Create the destination directory first. Schedule daily, keep dated copies on a separate volume/machine and keep a private credential backup as well:

```sh
mkdir -p /absolute/private/backups
npm run server:saves:backup -- /absolute/private/save-data /absolute/private/backups/family-2026-10-02.json
```

A typical daily host cron entry (adapt absolute paths and Node location):

```cron
15 3 * * * cd /absolute/yage && /usr/bin/node server/saves/backup.mjs backup /absolute/private/save-data /absolute/private/backups/family-$(date +\%F).json
```

Restore requires stopping the single writer. Before relying on the service, run this drill into a separate empty directory, restart it on another port, then fetch a known career and profile and compare their IDs, sequence, checksum and document with the archived values:

```sh
npm run server:saves:restore -- /absolute/private/restored-data /absolute/private/backups/family-2026-10-02.json
YAGE_SAVE_DIR=/absolute/private/restored-data PORT=3002 npm run server:saves
```

The restore command validates the complete archive before replacing state and rejects a live writer. It works even if the original database and every retained backup are lost. No archive content or raw credentials is printed. Stop the drill process before restoring production storage. Production restore is an explicit operator action; no API member can invoke it.

## Self-hosted container

Build from the YAGE repository root:

```sh
docker build -f server/saves/Dockerfile -t yage-family-save .
docker volume create yage-family-data
docker volume create yage-family-backups
docker run -d --name yage-family-save --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  -e YAGE_SAVE_OPERATOR_CREDENTIAL \
  -v yage-family-data:/data -v yage-family-backups:/backups yage-family-save
```

The container runs as the unprivileged `node` user. New named volumes inherit the prepared directory ownership; existing bind mounts must be writable by UID 1000. Keep the host's port behind the authenticated save protocol and HTTPS reverse proxy. Back up while live with `docker exec yage-family-save node server/saves/backup.mjs backup /data /backups/family-2026-10-02.json`; copy archives off the container volume daily. Stop the container and run a one-off instance with the same data/backups volumes and `node server/saves/backup.mjs restore /data /backups/FILE.json` to restore, then restart the normal process. The image and real VM/container/two-network recovery remain operator validation gates; local loopback tests do not prove deployment.

## Recorded validation — 2026-10-02

`npm run test:save-api` passes 14 behavioral tests, including two actual Socket.IO clients, same-room relay isolation, CAS races, concurrent delete/update, valid/invalid documents and profiles, offline fast-forward/divergence/promotion, private credential storage, restart, CLI SIGTERM, writer-lock rejection, corruption recovery and archive restore. Measured aggregate coverage is 100% lines, over 93% branches and over 98% functions. All new save modules pass ESLint with zero warnings, and the modified relay passes a scoped TypeScript compile.

An additional actual Sky Harbor fixture (`idle/test/fixtures/saves/a1.start.json`) round-tripped with the game's compiled v5 validator through `createSaveSocket` and `putCareerDocument`. Its `fixture:a1-start` identity remained unchanged; a document with local sequence 43/base sequence 1 remained valid inside server record sequence 2. This verifies the library contract, not boot/autosave wiring.

The YAGE development/test typecheck and full non-browser `npm run check` now pass after Node type visibility, runner ownership and public UI test access were corrected. ESLint on the pre-existing relay reports 11 existing non-null assertion warnings; no new save-module warning is suppressed. The coordinator owns final combined suites. The workstation deployment has completed a live dated backup and restore into a separate empty directory with actual server authentication and career/profile comparison. Container build, a deployed external endpoint, two-network/device-loss recovery, off-workstation backup storage remain pending. The managed workstation process now schedules the same verified archive and private credential companion every 24 hours, with persisted restart cadence; see its operating runbook.
