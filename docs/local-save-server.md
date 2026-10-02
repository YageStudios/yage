# Workstation save server

The phase 1 family save API runs on this workstation at `http://127.0.0.1:3001`.
It is a local endpoint. It is not accessible from another device through that
device's `localhost`. No public endpoint, tunnel or system service is configured.
The existing game adapter uses this API; it does not make the save process a
shared simulation authority.

Docker is installed but this user's daemon access is denied. The operating path
uses installed Node 24 or newer and the repository's locked dependencies. The
helpers are for this Linux workstation: they check `/proc/PID/cmdline` before
signalling a stored PID, so stale metadata cannot stop a different program.

From the YAGE repository:

```sh
npm ci
npm run server:saves:local -- init
npm run server:saves:local -- start
npm run server:saves:local -- status
```

The detached process survives closing its launching terminal. After a workstation
reboot, run `start` again. For a deliberate restart, run `stop`, then `start`:

```sh
npm run server:saves:local -- stop
npm run server:saves:local -- start
```

All operating files live under ignored `.local/save-server/`. Its directories have
mode 0700, credentials/data/logs have mode 0600. `operator.json` contains the server
operator credential; `family.json` contains parent and member credentials. Read
these only on the administration device; never paste the operator or parent token
into the game bundle, a command line, logs or a shared document. Helpers print only
metadata and file paths, never credential values. The database stores token hashes.

The deployed family has a Parent and a Captain member. For a fresh private
installation, create them once with:

```sh
npm run server:saves:admin -- setup
npm run server:saves:admin -- member
```

`setup` preserves an existing family file. `member` creates a new member each time;
use it only when adding a person, for example:

```sh
npm run server:saves:admin -- member .local/save-server "Captain 2" fox
```

The deployed private `client.json` is ready for the existing game adapter: it
contains the endpoint, family/member identity, member credential, stable career ID
and remote sequence. A fresh Sky Harbor career was seeded from the actual validated
`a1.start` checkpoint, with zero-cooldown captain identity mapped to this member.
Its progression and timers were preserved. Future installations need an existing
valid game export published before the adapter can load a remote career.
The operating drill creates a separate `deployment-verification` career with an
explicit non-gameplay purpose. It does not fabricate Sky Harbor progression.

## Daily backup and verified restore

The managed server takes an automatic backup on its first scheduled run, then
every 24 hours while it is running. It saves the last completion and next deadline
in private `backup-schedule.json`; restart preserves that deadline and immediately
catches up when overdue. Failures retry within one hour without claiming success.
The same process owns the timer, and stop clears it and waits for an in-flight
archive before releasing the server writer lock. No separate worker or host
scheduler is installed.

For an additional manual backup, run:

```sh
npm run server:saves:admin -- backup
```

It writes a dated checksum-verified database archive and a separate private
`-credentials.json` companion containing operator/family credentials and, when
present, the member game connection configuration under `.local/save-server/backups/`. Keep both files.
Copy both to separate private storage for workstation-loss protection. Files kept
on this workstation alone protect against some corruption, not loss of the disk.
Manual backups do not postpone the automatic deadline. For an isolated operating
test or a deliberately shorter cadence, `config.json` accepts `backupIntervalMs`
from 1 through 86400000; the default is 86400000. Restart applies the configuration.
The scheduler clock/timer seam is injected by tests, not a global workstation clock
change. Backups are automatic only while the managed server is running.

Run the operating restore drill periodically and after storage changes:

```sh
npm run server:saves:admin -- restore-check
```

The drill takes a live backup, restores into a new empty directory under
`.local/save-server/restore-drills/`, starts an actual localhost server on another
port, and uses the backed-up member credential to fetch the known verification
career and profile. It compares their complete IDs, sequences, checksums and
documents with the archive and checks that invalid credentials are rejected. It
also verifies the configured gameplay career when `client.json` is present. It
stops only the drill server; the original process keeps running. Drill directories
are retained for inspection.

For an explicit production database restore, stop the writer first:

```sh
npm run server:saves:local -- stop
npm run server:saves:restore -- .local/save-server/data /absolute/path/to/family-TIMESTAMP.json
```

If credentials were also lost, restore them from the matching companion using
this command, which writes private files without printing their values:

```sh
node --input-type=module - /absolute/path/to/family-TIMESTAMP-credentials.json <<'JS'
import { readFile, chmod } from 'node:fs/promises';
import { atomicWrite } from './server/saves/storage.mjs';
const backup = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const [name, value] of [['operator', backup.operator], ['family', backup.family]]) {
  await atomicWrite(`.local/save-server/${name}.json`, JSON.stringify(value));
  await chmod(`.local/save-server/${name}.json`, 0o600);
}
if (backup.client) await atomicWrite(`.local/save-server/client.json`, JSON.stringify(backup.client));
JS
npm run server:saves:local -- start
```

Then fetch the real game career through the adapter before continuing play. The
restore command refuses a live writer. Never remove a live writer lock manually.

## Verification

`npm run test:save:local` exercises initialization permissions/idempotence, detached
start/stop/restart, safe PID checks, member credentials, CLI commands, error paths,
actual backup/restored-server authentication, daily deadlines/retries, overdue
restart catch-up and timer shutdown while an archive is in progress. It enforces at least 80% line,
branch and function coverage and uses temporary storage, isolated from deployed
family data. `npm run check` includes this suite and the existing API, engine,
tooling, durability and peer-join gates. Native game acceptance remains separate.

Recorded on 2026-10-02: the actual game adapter loaded the fresh family career,
a two-client CAS race had one winner, and stop/start retained the accepted career.
A live backup and separate restored server verified complete career/profile records
and backed-up credentials. The untouched genesis timestamp was normalized to
deployment time through a CAS update, then checked with the actual adapter and
bootstrap first timetable. Automatic cadence, archive creation and timer shutdown
were verified in isolated managed processes. The live service completed its first
automatic archive and retained the exact next 24-hour deadline through restart;
the live database was unchanged. This is localhost operating evidence, not an external
endpoint or two-device network proof.
