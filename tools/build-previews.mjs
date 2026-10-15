// Builds a page and a link-preview image for every promise, into site/p/<id>/.
//
// Link previews are read by crawlers that run no scripts and ignore the part of an address after
// `#`, so each promise needs a real page with its own tags. That page sends people on to the board.
// No dependencies: plain JSON-RPC, and a headless browser already on the machine for the image.
//
//   node tools/build-previews.mjs
//   PREVIEWS_REQUIRED=1 ...   fail instead of skipping when the chain cannot be read
//   CHROME=/path/to/chrome    which browser draws the cards
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const VAULT = '0x3c81384aa1ca064316576a214e2fb30969992772';
const VAULT2 = '0x35fc6223307b55814a1a7a1b07c9c00d88e2b55c';
const IMD = '0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127';
const SITE = 'https://pinkybond.fun';
const OUT = fileURLToPath(new URL('../site/p/', import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// The public node allows about one request every seven seconds per address.
const NODE_GAP_MS = 8000;
const STATUS = ['Active', 'Closed', 'Asked', 'Kept', 'Broken', 'Refunded'];

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const word = (hex, i) => hex.slice(2 + 64 * i, 2 + 64 * (i + 1));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let lastCall = 0;
async function rpc(calls) {
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, lastCall + NODE_GAP_MS - Date.now()));
    lastCall = Date.now();
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }))),
      });
      if (!res.ok) throw new Error(`the node answered ${res.status}`);
      const byId = new Map((await res.json()).map((r) => [r.id, r]));
      return calls.map((_, i) => { const r = byId.get(i); return r && !r.error && r.result && r.result !== '0x' ? r.result : null; });
    } catch (e) {
      if (attempt === 5) throw e;
      console.log(`  read failed (${e.message}), trying again`);
      await sleep(60_000);
    }
  }
}

/** An ABI string result: offset, length, bytes. Tokens are free to return anything, so be careful. */
function abiString(hex) {
  try {
    const length = Number(BigInt(`0x${word(hex, 1)}`));
    if (length > 64) return '';
    return Buffer.from(hex.slice(2 + 128, 2 + 128 + 2 * length), 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '').trim();
  } catch { return ''; }
}

function amount(wei, decimals) {
  const n = Number(wei) / 10 ** decimals;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// The public node refuses a batch of more than about 55 calls (measured 2026-10-15): split.
const BATCH = 45;
async function rpcAll(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += BATCH) out.push(...await rpc(calls.slice(i, i + BATCH)));
  return out;
}

const big = (h, i) => BigInt(`0x${word(h, i)}`);
const addr = (h, i) => `0x${word(h, i).slice(24)}`;
const ZERO = '0x0000000000000000000000000000000000000000';
const KINDS = ['Keep', 'Pay', 'Hold', 'Moves'];

/** Both vaults' promises in one shape; `key` is the address on the site: `2` or `v2-1`. */
function fromV1(id, h) {
  return {
    key: String(id), id, vault: 'v1', kind: 'Keep',
    maker: addr(h, 0), token: addr(h, 1), amount: big(h, 2), bond: big(h, 3),
    endTime: Number(big(h, 6)), status: STATUS[Number(big(h, 10))], paid: big(h, 11) === 1n,
    observed: big(h, 15), target: ZERO, beneficiary: ZERO, failed: false,
  };
}
function fromV2(id, h) {
  return {
    key: `v2-${id}`, id, vault: 'v2', kind: KINDS[Number(big(h, 2))] ?? 'Keep',
    maker: addr(h, 0), token: addr(h, 1), status: STATUS[Number(big(h, 3))], paid: big(h, 5) === 1n,
    amount: big(h, 6), target: addr(h, 7), beneficiary: addr(h, 8), bond: big(h, 9),
    endTime: Number(big(h, 12)), observed: big(h, 18), failed: big(h, 19) === 1n,
  };
}

async function read() {
  const [countHex, count2Hex] = await rpc([{ to: VAULT, data: '0x06661abd' }, { to: VAULT2, data: '0x06661abd' }]);
  if (!countHex || !count2Hex) throw new Error('a vault did not answer');
  const ids = (n) => Array.from({ length: Number(BigInt(n)) }, (_, i) => i + 1);
  const ids1 = ids(countHex), ids2 = ids(count2Hex);
  const row = (to, id) => ({ to, data: `0x1f06c859${id.toString(16).padStart(64, '0')}` });
  const rows = await rpcAll([...ids1.map((id) => row(VAULT, id)), ...ids2.map((id) => row(VAULT2, id))]);
  const promises = [
    ...ids1.map((id, i) => rows[i] && fromV1(id, rows[i])),
    ...ids2.map((id, i) => rows[ids1.length + i] && fromV2(id, rows[ids1.length + i])),
  ].filter(Boolean);
  if (promises.length === 0) return [];

  const tokens = [...new Set(promises.map((p) => p.token))];
  // For a running Keep promise, also what the wallet holds now: the card weighs the bond against it.
  const running = promises.filter((p) => p.status === 'Active' && p.kind === 'Keep');
  const meta = await rpcAll([
    ...tokens.flatMap((to) => [{ to, data: '0x95d89b41' }, { to, data: '0x313ce567' }]),
    ...running.map((p) => ({ to: p.token, data: `0x70a08231${p.maker.slice(2).padStart(64, '0')}` })),
  ]);
  running.forEach((p, i) => { const h = meta[2 * tokens.length + i]; if (h) p.held = BigInt(h); });
  const info = new Map(tokens.map((t, i) => [t, {
    symbol: meta[2 * i] ? abiString(meta[2 * i]) : '',
    // An NFT has no decimals: its amounts are counts.
    decimals: meta[2 * i + 1] ? Math.min(36, Number(BigInt(meta[2 * i + 1]))) : 0,
  }]));
  for (const p of promises) Object.assign(p, info.get(p.token));
  if (running.length) await weigh(running);
  return promises;
}

/** Dollar prices from DexScreener (not the node), then the bond as a share of what is at stake. */
async function weigh(running) {
  let prices = {};
  try {
    const wanted = [...new Set([...running.map((p) => p.token), IMD])].slice(0, 30).join(',');
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${wanted}`, { headers: { 'User-Agent': UA } });
    const best = {};
    for (const pair of (await res.json()).pairs ?? []) {
      const token = pair.baseToken?.address?.toLowerCase();
      const price = Number(pair.priceUsd);
      const depth = Number(pair.liquidity?.usd ?? 0);
      if (pair.chainId !== 'robinhood' || !token || !(price > 0)) continue;
      if (!best[token] || depth > best[token].depth) best[token] = { price, depth };
    }
    prices = Object.fromEntries(Object.entries(best).map(([t, v]) => [t, v.price]));
  } catch (e) {
    console.log(`  no prices (${e.message}); cards go without the bond's share`);
  }
  for (const p of running) {
    if (p.held === undefined) continue;
    const atStake = p.held > p.amount ? p.held - p.amount : 0n;
    if (atStake === 0n) { p.cover = 'Right now the wallet holds no more than the limit.'; continue; }
    const tokenUsd = prices[p.token], imdUsd = prices[IMD];
    if (!tokenUsd || !imdUsd) continue;
    const share = (Number(p.bond) / 1e18 * imdUsd) / (Number(atStake) / 10 ** p.decimals * tokenUsd);
    p.cover = share >= 1 ? 'The bond is worth more than what the wallet could move.'
      : `The bond is worth ${share < 0.01 ? 'less than 1%' : `${Math.round(share * 100)}%`} of what the wallet could move.`;
  }
}

/** The words on the card and in the tags. Same voice as the board. */
function describe(p, now) {
  const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const who = short(p.maker);
  const symbol = p.symbol || 'this token';
  const n = (wei) => `${amount(wei, p.decimals)} ${symbol}`;
  const over = now >= p.endTime;
  const until = `${new Date(p.endTime * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
  const bond = `${amount(p.bond, 18)} IMD`;
  const to = p.beneficiary !== ZERO ? short(p.beneficiary) : null;
  let line, found;
  switch (p.kind) {
    case 'Pay':
      line = `${who} ${over ? 'promised to send' : 'will send'} at least ${n(p.amount)} to ${short(p.target)}.`;
      found = p.observed === 0n ? 'They sent nothing.' : `They sent ${n(p.observed)}.`;
      break;
    case 'Hold':
      line = `${who} ${over ? 'promised to still hold' : 'will still hold'} at least ${n(p.amount)} at the deadline.`;
      found = `At the deadline they held ${n(p.observed)}.`;
      break;
    case 'Moves':
      line = `${who} ${over ? 'promised not to move' : "won't move"} ${p.amount === 0n ? `a single one of ${symbol}` : `more than ${p.amount} of ${symbol}`}.`;
      found = `They moved ${p.observed} out.`;
      break;
    default:
      line = `${who} ${over ? 'promised not to move' : "won't move"} ${p.amount === 0n ? `a single ${symbol}` : `more than ${n(p.amount)}`}.`;
      found = `They moved ${n(p.observed)}.`;
  }
  const home = p.vault === 'v2' ? ', less 1% for PINKY stakers' : '';
  switch (p.status) {
    case 'Kept':
      return { badge: 'Kept', tone: 'kept', line, note: `Kept their word. The bond went home${home}.` };
    case 'Broken':
      return { badge: 'Broken', tone: 'broken', line, note: `${found} ${to ? `The bond goes to ${to}.` : 'The bond is gone.'}` };
    case 'Refunded':
      return { badge: 'No answer', tone: 'quiet', line, note: 'The oracle gave no answer, so the bond was returned.' };
    case 'Asked':
      return p.failed
        ? { badge: 'Ask again', tone: 'waiting', line, note: `${bond} on the line. The panel couldn't agree, so it will be asked again.` }
        : { badge: 'Counting', tone: 'waiting', line, note: `${bond} on the line. The swarm is counting.` };
    case 'Closed':
      return { badge: 'Closed', tone: 'waiting', line, note: `${bond} on the line. Waiting for the oracle.` };
    default:
      return over
        ? { badge: 'Time is up', tone: 'waiting', line, note: `${bond} on the line. Waiting to be closed.` }
        : { badge: 'Running', tone: 'waiting', line, note: `${bond} on the line until ${until}.${to ? ` Made to ${to}.` : ''}${p.cover ? ` ${p.cover}` : ''}` };
  }
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..700,100,1&family=Nunito:wght@600;700&display=block';
const MARK = '<svg viewBox="40 30 100 120"><g fill="none" stroke-width="13" stroke-linecap="round"><path d="M66 44 V92 A16 16 0 0 0 98 92 V84" stroke="#F4EEDD"/><path d="M114 136 V88 A16 16 0 0 0 82 88 V96" stroke="#E79AA8"/></g></svg>';

function cardHtml(p, d) {
  const badge = { kept: 'background:#E79AA8;color:#5E1224;border-color:#E79AA8', broken: 'background:#F4EEDD;color:#5E1224;border-color:#F4EEDD', quiet: 'color:#EBDCD0;border-color:#8a4a57', waiting: 'color:#F4EEDD;border-color:#E79AA8' }[d.tone];
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#5E1224;color:#F4EEDD;font-family:Nunito,sans-serif}
.arc{position:absolute;right:-250px;bottom:-250px;width:500px;height:500px;border-radius:50%;border:104px solid #E79AA8;box-sizing:border-box}
.top{position:absolute;left:80px;top:64px;display:flex;align-items:center;gap:14px}
.top svg{width:52px;height:62px}
.top b{font:600 54px/1 Fraunces,serif;font-variation-settings:'SOFT' 100,'WONK' 1}
.badge{position:absolute;right:80px;top:74px;padding:8px 26px;border-radius:999px;border:3px solid;font:700 28px/1.3 Nunito,sans-serif;${badge}}
h1{position:absolute;left:80px;right:80px;top:196px;margin:0;font:600 66px/1.12 Fraunces,serif;font-variation-settings:'SOFT' 100,'WONK' 1;overflow-wrap:anywhere}
h1 span{font:700 .62em ui-monospace,Consolas,monospace;letter-spacing:-.02em;color:#E79AA8}
p{position:absolute;left:82px;right:300px;bottom:112px;margin:0;font:600 32px/1.3 Nunito,sans-serif;color:#EBDCD0}
.foot{position:absolute;left:82px;bottom:56px;font:700 26px/1 Nunito,sans-serif;color:#E79AA8}
</style></head><body><div class="arc"></div>
<div class="top">${MARK}<b>pinky</b></div><div class="badge">${esc(d.badge)}</div>
<h1>${esc(d.line).replace(/^(0x\w{4}…\w{4})/, '<span>$1</span>')}</h1>
<p>${esc(d.note)}</p><div class="foot">pinkybond.fun · promise #${p.id}${p.vault === 'v1' ? ' · first vault' : ''}</div>
</body></html>`;
}

function pageHtml(p, d, image) {
  const url = `${SITE}/p/${p.key}/`;
  const title = `${d.line} — Pinky`;
  const text = `${d.note} Promise #${p.id} on Pinky: a promise with money behind it.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(text)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(d.line)}">
<meta property="og:description" content="${esc(text)}">
<meta property="og:image" content="${url}${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#5E1224">
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<meta http-equiv="refresh" content="0; url=/#p${p.key}">
<script>location.replace('/#p${p.key}');</script>
</head>
<body style="margin:0;background:#5E1224;color:#F4EEDD;font:18px system-ui,sans-serif">
<p style="padding:24px"><a href="/#p${p.key}" style="color:#E79AA8">Open promise #${p.id} on Pinky</a></p>
</body>
</html>
`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean);
  for (const c of candidates) {
    if (c.includes('\\') || c.includes('/')) { if (existsSync(c)) return c; continue; }
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch { /* not this one */ }
  }
  throw new Error('no headless browser found; set CHROME');
}

async function main() {
  const promises = await read();
  console.log(`promises on chain: ${promises.length}`);
  await rm(OUT, { recursive: true, force: true });
  if (promises.length === 0) return;

  const chrome = findChrome();
  const tmp = await mkdtemp(join(tmpdir(), 'pinky-cards-'));
  const now = Date.now() / 1000;
  for (const p of promises) {
    const d = describe(p, now);
    const dir = join(OUT, p.key);
    await mkdir(dir, { recursive: true });
    // The status is in the file name, so a preview cached as "Running" is not reused for "Kept".
    const image = `card-${d.badge.toLowerCase().replace(/[^a-z]+/g, '-')}.png`;
    const card = join(tmp, `${p.key}.html`);
    await writeFile(card, cardHtml(p, d));
    execFileSync(chrome, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--virtual-time-budget=10000', `--user-data-dir=${join(tmp, 'profile')}`, '--window-size=1200,630',
      `--screenshot=${join(dir, image)}`, pathToFileURL(card).href,
    ], { stdio: 'ignore', timeout: 120_000 });
    if (!existsSync(join(dir, image))) throw new Error(`the browser drew nothing for promise #${p.id}`);
    await writeFile(join(dir, 'index.html'), pageHtml(p, d, image));
    console.log(`  ${p.key} ${d.badge}: ${d.line}`);
  }
  await rm(tmp, { recursive: true, force: true });
}

try {
  await main();
} catch (e) {
  console.log(`previews not built: ${e.message}`);
  // A scheduled run that cannot read the chain should fail and leave the live site as it is;
  // a deploy after a code change should still go out, without preview pages.
  process.exit(process.env.PREVIEWS_REQUIRED === '1' ? 1 : 0);
}
