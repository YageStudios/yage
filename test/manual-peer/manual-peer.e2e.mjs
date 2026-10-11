// Real-browser check of the serverless code swap: two pages exchange one code each, then the data channel carries
// small and chunked messages both ways. Run: node test/manual-peer/manual-peer.e2e.mjs (CHROMIUM_PATH optional).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '../..');
const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

const bundle = (await build({
  stdin: { contents: 'import * as m from "./engine/connection/ManualPeer.ts"; window.M = m;', resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'iife', platform: 'browser', alias: { 'yage': path.join(root, 'engine') },
})).outputFiles[0].text;

async function pair(args) {
  const browser = await chromium.launch({ executablePath, headless: true, args });
  const [host, guest] = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const page of [host, guest]) { await page.setContent('<html></html>'); await page.addScriptTag({ content: bundle }); }
  return { browser, host, guest };
}

for (const [name, args] of [['mDNS host candidates', []], ['plain IP candidates', ['--disable-features=WebRtcHideLocalIpsWithMdns']]]) {
  test(`code swap opens a channel with ${name}`, { timeout: 30000 }, async () => {
    const { browser, host, guest } = await pair(args);
    try {
      const offer = await host.evaluate(async () => { const { link, code } = await M.ManualLink.offer('v1-HOST'); window.link = link; return code; });
      assert.ok(offer.length < 400, `offer code is short enough for an easy QR (${offer.length})`);
      assert.equal(M_decodeKind(offer), 'o');
      const answer = await guest.evaluate(async offer => {
        const { link, code } = await M.ManualLink.answer('v1-GUEST', 'https://example.test/#join=' + encodeURIComponent(offer));
        window.opened = link.opened.then(conn => { window.conn = conn; window.got = []; conn.on('data', d => window.got.push(d)); });
        return code;
      }, offer);
      assert.ok(answer.length < 400);
      const remote = await host.evaluate(async answer => {
        const conn = await window.link.accept(answer); window.conn = conn; window.got = []; conn.on('data', d => window.got.push(d));
        return conn.peer;
      }, answer);
      assert.equal(remote, 'v1-GUEST');
      await guest.evaluate(() => window.opened);
      assert.equal(await guest.evaluate(() => window.conn.peer), 'v1-HOST');
      // Same framing PeerJS uses: arrays of mixed values, and a state string far above the 16 KB chunk size.
      const big = 'x'.repeat(300000) + 'end';
      await host.evaluate(big => { window.conn.send(['h', 'frame', { a: 1, b: [true, null] }]); window.conn.send(['h', 'state', big]); }, big);
      await guest.evaluate(() => window.conn.send(['g', 'peer', 'v1-GUEST', { netId: 'g' }]));
      await guest.waitForFunction(() => window.got.length === 2, null, { timeout: 10000 });
      await host.waitForFunction(() => window.got.length === 1, null, { timeout: 10000 });
      const got = await guest.evaluate(() => window.got);
      assert.deepEqual(got[0], ['h', 'frame', { a: 1, b: [true, null] }]);
      assert.equal(got[1][2].length, big.length);
      assert.deepEqual(await host.evaluate(() => window.got[0]), ['g', 'peer', 'v1-GUEST', { netId: 'g' }]);
      // Closing one side is seen by the other, which is how the game notices a guest leaving.
      const closed = guest.evaluate(() => new Promise(resolve => window.conn.on('close', () => resolve(true))));
      await host.evaluate(() => window.conn.close());
      assert.equal(await closed, true);
    } finally { await browser.close(); }
  });
}

function M_decodeKind(code) { return code.split('*')[1]; }

test('codes reject the wrong role and damaged input', { timeout: 30000 }, async () => {
  const { browser, host } = await pair([]);
  try {
    const errors = await host.evaluate(async () => {
      const { link, code } = await M.ManualLink.offer('v1-A');
      const out = [];
      for (const attempt of [() => link.accept(code), () => M.ManualLink.answer('v1-B', 'hello'), () => M.ManualLink.answer('v1-B', code.slice(0, 20))])
        try { await attempt(); out.push('accepted'); } catch (e) { out.push(e.message); }
      return out;
    });
    assert.match(errors[0], /host code/);
    assert.match(errors[1], /not a game connection code/);
    assert.match(errors[2], /incomplete|damaged/);
  } finally { await browser.close(); }
});
