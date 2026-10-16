import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, isAddress, parseUnits } from 'https://esm.sh/viem@2.57.4';
import { config } from './config.js';

const $ = (sel) => document.querySelector(sel);
const STATUS = ['Active', 'Closed', 'Asked', 'Kept', 'Broken', 'Refunded'];
// The public node allows about one request every seven seconds per address, and since 2026-10-15
// refuses a batch of more than about 55 calls with a 429 (whose CORS header is broken, so the
// browser only sees a failed fetch). The board's read stays under 50: the newest PAGE promises of
// the second vault and the first vault's few, which no longer takes new ones from this page.
const PAGE = 28;
const PAGE_V1 = 6;
const NODE_GAP_MS = 7500;

const vaultAbi = [
  { type: 'function', name: 'count', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'minBond', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'promises', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { name: 'maker', type: 'address' }, { name: 'token', type: 'address' }, { name: 'maxOut', type: 'uint256' },
    { name: 'bond', type: 'uint256' }, { name: 'startBlock', type: 'uint64' }, { name: 'endBlock', type: 'uint64' },
    { name: 'endTime', type: 'uint64' }, { name: 'closedAt', type: 'uint64' }, { name: 'askedAt', type: 'uint64' },
    { name: 'attempts', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'paid', type: 'bool' },
    { name: 'asker', type: 'address' }, { name: 'intake', type: 'address' }, { name: 'requestId', type: 'bytes32' },
    { name: 'observedOut', type: 'uint256' },
  ] },
  { type: 'function', name: 'make', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'close', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'ask', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'payout', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
];
// The second vault: the same life cycle, four kinds of promise, an optional beneficiary.
const KINDS = ['Keep', 'Pay', 'Hold', 'Moves'];
const vault2Abi = [
  { type: 'function', name: 'count', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fees', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'promises', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [
    { name: 'maker', type: 'address' }, { name: 'token', type: 'address' }, { name: 'kind', type: 'uint8' },
    { name: 'status', type: 'uint8' }, { name: 'attempts', type: 'uint8' }, { name: 'paid', type: 'bool' },
    { name: 'amount', type: 'uint256' }, { name: 'target', type: 'address' }, { name: 'beneficiary', type: 'address' },
    { name: 'bond', type: 'uint256' }, { name: 'startBlock', type: 'uint64' }, { name: 'endBlock', type: 'uint64' },
    { name: 'endTime', type: 'uint64' }, { name: 'closedAt', type: 'uint64' }, { name: 'askedAt', type: 'uint64' },
    { name: 'asker', type: 'address' }, { name: 'intake', type: 'address' }, { name: 'requestId', type: 'bytes32' },
    { name: 'observed', type: 'uint256' }, { name: 'failed', type: 'bool' },
  ] },
  { type: 'function', name: 'make', stateMutability: 'nonpayable', inputs: [
    { type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' },
  ], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'settle', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'ask', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'payout', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'refund', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'sendFees', stateMutability: 'nonpayable', inputs: [], outputs: [] },
];
const ZERO = '0x0000000000000000000000000000000000000000';
// The second vault's timing, from the contract: anyone but the maker closes two minutes after the
// deadline, an unanswered request may be asked again after a day, the bond comes back after a week.
const CLOSE_GRACE = 120;
const ANSWER_TIMEOUT = 86400;
const REFUND_GRACE = 7 * 86400;
const FEE_BPS = 100n;

const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const intakeAbi = [
  { type: 'function', name: 'priceOf', stateMutability: 'view', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const stakingAbi = [
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'rewardRate', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'periodFinish', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'earned', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'stake', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'unstake', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [] },
];

const state = {
  account: null, promises: [], minBond: 5n * 10n ** 18n, preview: !config.vault,
  // The oracle's price for one question, in IMD wei. Read from the Intake with the board.
  fee: 5n * 10n ** 17n,
  // The second vault's 1% fees, waiting to be sent to stakers.
  fees: 0n,
  // For running promises: what the maker's wallet holds of the token (by promise id), and market
  // prices in dollars (by token address). Together they say how much the bond is worth next to
  // what it is guarding.
  balances: {},
  prices: {},
  pricesAt: 0,
  // The staking pool as everyone sees it, and the connected wallet's place in it.
  pool: { totalStaked: 0n, rewardRate: 0n, periodFinish: 0 },
  mine: null,
  tokens: loadTokens(),
  // When each running promise began, by id: the vault stores the block, not the time.
  starts: config.vault ? loadCache(`pinky.starts.${config.vault}`) : {},
  // The status each promise had last time it was drawn, to notice a verdict arriving,
  // and which cards are still having their moment.
  seen: new Map(),
  fresh: new Map(),
  drawn: '',
};

// ───────────────────────── reading ─────────────────────────

function loadCache(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
}
function loadTokens() { return loadCache('pinky.tokens'); }

/** One HTTP request, many calls: the node counts requests, not what is inside them. */
async function rpc(batch) {
  const body = batch.map((b, i) => ({ jsonrpc: '2.0', id: i, method: b.method, params: b.params }));
  const res = await fetch(config.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`the node answered ${res.status}`);
  const byId = new Map((await res.json()).map((r) => [r.id, r]));
  return batch.map((_, i) => { const r = byId.get(i); return r && !r.error ? r.result ?? null : null; });
}

const asCall = (c) => ({ method: 'eth_call', params: [{ to: c.to, data: encodeFunctionData(c) }, 'latest'] });
function decode(c, result) {
  if (!result || result === '0x') return null;
  try { return decodeFunctionResult({ abi: c.abi, functionName: c.functionName, data: result }); } catch { return null; }
}

async function nodeBatch(calls) {
  const out = await rpc(calls.map(asCall));
  return calls.map((c, i) => decode(c, out[i]));
}

/**
 * Both vaults' promises in one shape. `key` names a promise across the two: the first vault's
 * keep their plain numbers (so /p/2/ still means promise #2), the second vault's are `v2-1`, `v2-2`…
 */
function asPromise(vault, id, row) {
  const abi = vault === 'v2' ? vault2Abi : vaultAbi;
  const o = Object.fromEntries(abi.find((f) => f.name === 'promises').outputs.map((out, j) => [out.name, row[j]]));
  if (vault === 'v2') return { ...o, key: `v2-${id}`, vault, id, kind: KINDS[o.kind] ?? 'Keep' };
  return { ...o, key: String(id), vault, id, kind: 'Keep', amount: o.maxOut, observed: o.observedOut, target: ZERO, beneficiary: ZERO, failed: false };
}

async function readBoard() {
  const vault = { to: config.vault, abi: vaultAbi };
  const vault2 = { to: config.vault2, abi: vault2Abi };
  const pool = { to: config.staking, abi: stakingAbi };
  const calls = [
    { ...vault, functionName: 'count' }, { ...vault, functionName: 'minBond' },
    { ...pool, functionName: 'totalStaked' }, { ...pool, functionName: 'rewardRate' }, { ...pool, functionName: 'periodFinish' },
    { ...vault2, functionName: 'count' }, { ...vault2, functionName: 'fees' },
  ];
  const head = calls.length;
  for (let id = 1; id <= PAGE_V1; id++) calls.push({ ...vault, functionName: 'promises', args: [BigInt(id)] });
  // The second vault's newest PAGE, from the count seen last time, with room for a few new ones.
  const known = Number(state.count2 ?? loadCache('pinky.count2').n ?? 0);
  const from = Math.max(1, known - PAGE + 4);
  for (let id = from; id < from + PAGE; id++) calls.push({ ...vault2, functionName: 'promises', args: [BigInt(id)] });
  // Running promises seen last time: ask what their makers hold now, in the same request.
  const watched = state.promises.filter((p) => STATUS[p.status] === 'Active').slice(0, 8);
  for (const p of watched) calls.push({ to: p.token, abi: erc20Abi, functionName: 'balanceOf', args: [p.maker] });
  // What the oracle charges for one question right now. Last in the batch, so nothing above moves.
  calls.push({ to: config.intake, abi: intakeAbi, functionName: 'priceOf', args: [config.oracleAction, config.imd] });
  const out = await nodeBatch(calls);
  const [count, minBond, totalStaked, rewardRate, periodFinish, count2, fees] = out;
  const rows = out.slice(head, head + PAGE_V1);
  const rows2 = out.slice(head + PAGE_V1, head + PAGE_V1 + PAGE);
  const tail = head + PAGE_V1 + PAGE;
  watched.forEach((p, i) => { const held = out[tail + i]; if (held !== null) state.balances[p.key] = held; });
  const fee = out[tail + watched.length];
  if (fee) state.fee = fee;
  if (count === null || count2 === null) throw new Error('the vault did not answer');
  if (minBond) state.minBond = minBond;
  if (fees !== null) state.fees = fees;
  if (totalStaked !== null) state.pool = { totalStaked, rewardRate: rewardRate ?? 0n, periodFinish: Number(periodFinish ?? 0n) };
  const n2 = Number(count2);
  const first = rows.slice(0, Number(count)).map((row, i) => row && asPromise('v1', i + 1, row)).filter(Boolean);
  const second = rows2.map((row, i) => row && from + i <= n2 && asPromise('v2', from + i, row)).filter(Boolean);
  // Newest first: every promise in the second vault is newer than the first vault's.
  state.promises = [...second.reverse(), ...first.reverse()];
  state.total = Number(count) + n2;
  state.count2 = n2;
  try { localStorage.setItem('pinky.count2', JSON.stringify({ n: n2 })); } catch { /* private window */ }
  // More new promises than the read had room for: look again soon, from the new count.
  return n2 >= from + PAGE;
}

/** Second request: what the board cannot say by itself — token names, and when running promises began. */
async function readExtras() {
  // At most 48 calls, under the node's batch limit; whatever does not fit comes on the next round.
  const tokens = [...new Set(state.promises.map((p) => p.token.toLowerCase()))].filter((t) => !state.tokens[t]).slice(0, 16);
  const running = state.promises.filter((p) => STATUS[p.status] === 'Active' && !state.starts[p.key]).slice(0, 8);
  // A promise seen for the first time has no balance yet; later ones ride along with the board.
  const unsized = state.promises.filter((p) => STATUS[p.status] === 'Active' && state.balances[p.key] === undefined).slice(0, 8);
  if (!tokens.length && !running.length && !unsized.length) return false;
  await new Promise((ok) => setTimeout(ok, NODE_GAP_MS));
  const calls = tokens.flatMap((to) => [{ to, abi: erc20Abi, functionName: 'symbol' }, { to, abi: erc20Abi, functionName: 'decimals' }]);
  const held = unsized.map((p) => ({ to: p.token, abi: erc20Abi, functionName: 'balanceOf', args: [p.maker] }));
  const out = await rpc([
    ...calls.map(asCall),
    ...running.map((p) => ({ method: 'eth_getBlockByNumber', params: [`0x${BigInt(p.startBlock).toString(16)}`, false] })),
    ...held.map(asCall),
  ]);
  unsized.forEach((p, i) => {
    const value = decode(held[i], out[calls.length + running.length + i]);
    if (value !== null) state.balances[p.key] = value;
  });
  tokens.forEach((t, i) => {
    const decimals = decode(calls[2 * i + 1], out[2 * i + 1]);
    if (decimals !== null) state.tokens[t] = { symbol: decode(calls[2 * i], out[2 * i]) ?? '', decimals: Number(decimals) };
  });
  running.forEach((p, i) => {
    const block = out[calls.length + i];
    if (block?.timestamp) state.starts[p.key] = Number(block.timestamp);
  });
  localStorage.setItem('pinky.tokens', JSON.stringify(state.tokens));
  localStorage.setItem(`pinky.starts.${config.vault}`, JSON.stringify(state.starts));
  return true;
}

/**
 * Dollar prices for the tokens of running promises and for IMD, from DexScreener: the deepest
 * pool on this chain where the token is the base. Not a node request, and kept for five minutes.
 */
async function readPrices() {
  const wanted = [...new Set(state.promises.filter((p) => STATUS[p.status] === 'Active').map((p) => p.token.toLowerCase()))];
  if (!wanted.length || Date.now() - state.pricesAt < 300_000) return false;
  state.pricesAt = Date.now();
  return fetchPrices(wanted);
}

/** Adds dollar prices for these tokens and IMD to what is known. True when the answer arrived. */
async function fetchPrices(tokens) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${[...tokens, config.imd.toLowerCase()].slice(0, 30).join(',')}`);
  if (!res.ok) return false;
  const best = {};
  for (const pair of (await res.json()).pairs ?? []) {
    const token = pair.baseToken?.address?.toLowerCase();
    const price = Number(pair.priceUsd);
    const depth = Number(pair.liquidity?.usd ?? 0);
    if (pair.chainId !== 'robinhood' || !token || !(price > 0)) continue;
    if (!best[token] || depth > best[token].depth) best[token] = { price, depth };
  }
  state.prices = { ...state.prices, ...Object.fromEntries(Object.entries(best).map(([t, v]) => [t, v.price])) };
  return true;
}

/** How the bond compares with what the wallet could still move. Only for a running Keep promise. */
function cover(p) {
  const meta = state.tokens[p.token.toLowerCase()];
  const held = state.balances[p.key];
  if (p.kind !== 'Keep' || STATUS[p.status] !== 'Active' || !meta || held === undefined) return '';
  const atStake = held > p.amount ? held - p.amount : 0n;
  if (atStake === 0n) return "Right now this wallet holds no more than the limit, so there's nothing here to break.";
  const tokenUsd = state.prices[p.token.toLowerCase()];
  const imdUsd = state.prices[config.imd.toLowerCase()];
  if (!tokenUsd || !imdUsd) return `This wallet could move ${amount(p, atStake)}. There's no market price for it, so the bond can't be weighed against that.`;
  const stakeUsd = Number(formatUnits(atStake, meta.decimals)) * tokenUsd;
  const share = (Number(formatUnits(p.bond, 18)) * imdUsd) / stakeUsd;
  const dollars = stakeUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: stakeUsd < 100 ? 2 : 0 });
  const what = `the ${amount(p, atStake)} this wallet could move, about ${dollars} at the last pool price`;
  if (share >= 1) return `The bond is worth <b>more than</b> ${what}.`;
  const pct = share < 0.01 ? 'less than 1%' : `${Math.round(share * 100)}%`;
  return `The bond is worth <b>${pct}</b> of ${what}.`;
}

const previewSince = Math.floor(Date.now() / 1000);

function previewData() {
  const now = Math.floor(Date.now() / 1000);
  const t = '0x00000000000000000000000000000000000a11ce';
  state.tokens[t] = { symbol: 'MEME', decimals: 18 };
  const base = { token: t, attempts: 1, paid: false, asker: ZERO, observed: 0n, vault: 'v2', kind: 'Keep', target: ZERO, beneficiary: ZERO, failed: false };
  const e18 = 10n ** 18n;
  state.starts['v2-4'] = previewSince - 300;
  state.balances['v2-4'] = 12000000n * e18;
  state.prices = { [t]: 0.00002, [config.imd.toLowerCase()]: 8.5 };
  state.pool = { totalStaked: 31400000n * e18, rewardRate: 22n * e18 / 604800n, periodFinish: previewSince + 5 * 86400 };
  // The third example gets its verdict a few seconds in, so the preview shows a promise being kept.
  const counted = now - previewSince >= 12;
  state.promises = [
    { ...base, id: 4, maker: '0x1111111111111111111111111111111111111111', amount: 0n, bond: 20n * e18, endTime: previewSince + 1500, status: 0, attempts: 0 },
    { ...base, id: 3, maker: '0x2222222222222222222222222222222222222222', kind: 'Pay', amount: 1000000n * e18, target: '0x5555555555555555555555555555555555555555', beneficiary: '0x5555555555555555555555555555555555555555', bond: 95n * e18 / 10n, endTime: previewSince - 300, status: counted ? 3 : 2 },
    { ...base, id: 2, maker: '0x3333333333333333333333333333333333333333', amount: 0n, bond: 0n, endTime: now - 7200, status: 3, paid: true },
    { ...base, id: 1, maker: '0x4444444444444444444444444444444444444444', amount: 5000000n * e18, bond: 0n, endTime: now - 90000, status: 4, paid: true, observed: 48000000n * e18 },
  ].map((p) => ({ ...p, key: `v2-${p.id}` }));
  state.total = 4;
}

// ───────────────────────── rendering ─────────────────────────

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const imd = (wei) => Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const link = (kind, value, text) => state.preview ? esc(text) : `<a href="${config.explorer}/${kind}/${value}" target="_blank" rel="noopener">${esc(text)}</a>`;

function amount(p, wei) {
  const meta = state.tokens[p.token.toLowerCase()];
  if (!meta) return '…';
  const n = Number(formatUnits(wei, meta.decimals));
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${esc(meta.symbol || 'tokens')}`;
}

function countdown(ts) {
  const left = Math.max(0, Math.round(Number(ts) - Date.now() / 1000));
  if (left >= 172800) return `${Math.round(left / 86400)} days`;
  const h = Math.floor(left / 3600);
  const m = String(Math.floor((left % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const s = String(left % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

const hooks = (cls) => `<svg class="hooks ${cls}" viewBox="40 30 100 120" aria-hidden="true"><g fill="none" stroke-width="14" stroke-linecap="round"><path class="h1" d="M66 44 V92 A16 16 0 0 0 98 92 V84"/><path class="h2" d="M114 136 V88 A16 16 0 0 0 82 88 V96"/></g></svg>`;

/** Every second: countdowns and term bars move without redrawing the board. */
function tick() {
  const now = Date.now() / 1000;
  let ended = false;
  for (const el of document.querySelectorAll('[data-countdown]')) {
    el.textContent = countdown(el.dataset.countdown);
    if (now >= Number(el.dataset.countdown)) ended = true;
  }
  for (const el of document.querySelectorAll('[data-term]')) {
    const [start, end] = el.dataset.term.split(',').map(Number);
    el.style.width = `${Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)).toFixed(2)}%`;
  }
  if (ended) render();
}

/** An amount of the promise's token. NFTs have no decimals: they are counted as they are. */
function countOf(p, wei) {
  const meta = state.tokens[p.token.toLowerCase()];
  if (meta || (p.kind !== 'Hold' && p.kind !== 'Moves')) return amount(p, wei);
  return BigInt(wei).toLocaleString('en-US');
}
const someone = (a) => `<span class="who">${link('address', a, short(a))}</span>`;
const isMe = (a) => !!state.account && a.toLowerCase() === state.account.toLowerCase();

/** The promise as one sentence, in the tense of where it stands. */
function sayOf(p, over) {
  const who = state.preview ? esc(short(p.maker)) : `<a href="#w${p.maker.toLowerCase()}" title="Every promise this wallet made">${esc(short(p.maker))}</a>`;
  const symbol = state.tokens[p.token.toLowerCase()]?.symbol;
  const lead = `<span class="who">${who}</span>`;
  switch (p.kind) {
    case 'Pay':
      return `${lead} ${over ? 'promised to send' : 'will send'} at least ${countOf(p, p.amount)} to ${someone(p.target)}.`;
    case 'Hold':
      return `${lead} ${over ? 'promised to still hold' : 'will still hold'} at least ${countOf(p, p.amount)} at the deadline.`;
    case 'Moves': {
      const what = symbol ? esc(symbol) : 'these NFTs';
      return `${lead} ${over ? 'promised not to move' : "won't move"} ${p.amount === 0n ? `a single one of ${what}` : `more than ${countOf(p, p.amount)} of ${what}`}.`;
    }
    default: {
      const limit = p.amount === 0n ? 'a single token' : `more than ${amount(p, p.amount)}`;
      const of = p.amount === 0n && symbol ? ` of ${esc(symbol)}` : '';
      return `${lead} ${over ? 'promised not to move' : "won't move"} ${limit}${of}.`;
    }
  }
}

/** What the oracle found, for a broken promise. */
function foundOf(p) {
  switch (p.kind) {
    case 'Pay': return p.observed === 0n ? 'They sent nothing.' : `They sent ${countOf(p, p.observed)}.`;
    case 'Hold': return `At the deadline they held ${countOf(p, p.observed)}.`;
    case 'Moves': return `They moved ${BigInt(p.observed).toLocaleString('en-US')} out.`;
    default: return `They moved ${amount(p, p.observed)}.`;
  }
}

/** Once the oracle has had its chances, or a week has passed since the close, the bond can go home. */
function refundable(p, now) {
  const status = STATUS[p.status];
  if (status === 'Closed') return now >= Number(p.closedAt) + REFUND_GRACE;
  if (status !== 'Asked' || now < Number(p.askedAt) + ANSWER_TIMEOUT) return false;
  return p.attempts >= 3 || now >= Number(p.closedAt) + REFUND_GRACE;
}

function describe(p) {
  const now = Date.now() / 1000;
  const over = now >= Number(p.endTime);
  const say = sayOf(p, over);
  const v2 = p.vault === 'v2';
  const refund = refundable(p, now) ? ['refund', 'Return the bond'] : null;
  switch (STATUS[p.status]) {
    case 'Active': {
      if (!over) return { say, badge: ['waiting', 'Running'], note: `Ends in <b data-countdown="${Number(p.endTime)}"></b>.`, running: true };
      if (!v2) return { say, badge: ['waiting', 'Time is up'], note: 'Anyone can close it now.', action: ['close', 'Close it'] };
      // The second vault lets the maker close at the deadline, everyone else two minutes later.
      const anyone = Number(p.endTime) + CLOSE_GRACE;
      if (isMe(p.maker)) return { say, badge: ['waiting', 'Time is up'], note: 'Close it now: the count stops at the block it closes in.', action: ['settle', 'Close it'] };
      if (now < anyone) return { say, badge: ['waiting', 'Time is up'], note: `The maker can close it now. Anyone can in <b data-countdown="${anyone}"></b>.` };
      return { say, badge: ['waiting', 'Time is up'], note: 'Anyone can close it now.', action: ['settle', 'Close it'] };
    }
    case 'Closed':
      return { say, badge: ['waiting', 'Closed'], note: `Ready for the oracle${v2 ? ' a few seconds after closing' : ''}. Asking costs the bond ${imd(state.fee)} IMD.`, action: refund ?? [v2 ? 'settle' : 'ask', 'Ask the oracle'] };
    case 'Asked': {
      const left = 3 - p.attempts;
      if (refund) return { say, badge: ['quiet', 'No answer'], note: 'The oracle has had its chances. The bond can go home.', action: refund };
      if (v2 && p.failed) {
        return left > 0
          ? { say, badge: ['waiting', 'Ask again'], note: `The panel couldn't settle on an answer. Anyone can ask again now, ${left} ${left === 1 ? 'try' : 'tries'} left.`, action: ['ask', 'Ask again'] }
          : { say, badge: ['quiet', 'No answer'], note: 'The panel couldn\'t settle on an answer three times. The bond goes home a day after the last ask.' };
      }
      if (left > 0 && now >= Number(p.askedAt) + ANSWER_TIMEOUT) return { say, badge: ['waiting', 'Counting'], note: 'No answer for a day. Anyone can ask again.', action: ['ask', 'Ask again'] };
      return { say, badge: ['waiting', 'Counting'], note: `The swarm is counting<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> Attempt ${p.attempts} of 3.` };
    }
    case 'Kept': {
      const less = v2 ? ', less 1% for PINKY stakers' : '';
      return { say, badge: ['kept', 'Kept'], note: p.paid ? `Kept their word. The bond went home${less}.` : `Kept their word. The bond is ready to go home${less}.`, action: p.paid ? null : ['payout', 'Send it home'] };
    }
    case 'Broken': {
      const to = p.beneficiary && p.beneficiary !== ZERO ? p.beneficiary : null;
      const where = to
        ? (p.paid ? `The bond went to ${someone(to)}.` : `The bond goes to ${someone(to)}.`)
        : (p.paid ? 'The bond is gone.' : 'The bond is forfeit.');
      return { say, badge: ['broken', 'Broken'], note: `${foundOf(p)} ${where}`, action: p.paid ? null : ['payout', to ? `Pay ${short(to)}` : 'Split the bond'] };
    }
    default:
      return { say, badge: ['quiet', 'No answer'], note: 'The oracle gave no answer, so the bond was returned.' };
  }
}

/** A post about one promise, in words anyone can read without the board. */
function shareOnX(p, d) {
  const box = document.createElement('div');
  box.innerHTML = d.say;
  const status = STATUS[p.status];
  const end = { Kept: ' Kept.', Broken: ' Broken.' }[status] ?? ` ${imd(p.bond)} IMD on it.`;
  const text = `${box.textContent}${end} Pinky promise.`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(promiseUrl(p.key))}`;
}

/** #w0x… shows one wallet's promises: its record, kept and broken, in one line. */
function walletId() {
  const m = /^#w(0x[0-9a-fA-F]{40})$/.exec(location.hash);
  return m ? m[1].toLowerCase() : null;
}
function renderWallet(wallet, shown) {
  const box = $('#walletView');
  const mine = $('#minePromises');
  mine.hidden = !state.account || wallet === state.account.toLowerCase();
  if (state.account) mine.href = `#w${state.account.toLowerCase()}`;
  box.hidden = !wallet;
  if (!wallet) return;
  const n = (s) => shown.filter((p) => STATUS[p.status] === s).length;
  const kept = n('Kept'), broken = n('Broken');
  const bonded = shown.reduce((s, p) => s + p.bond, 0n);
  const whose = state.account && wallet === state.account.toLowerCase() ? 'Your wallet' : `Wallet ${short(wallet)}`;
  const record = shown.length
    ? `${shown.length} ${shown.length === 1 ? 'promise' : 'promises'}, ${kept} kept, ${broken} broken.${bonded ? ` ${imd(bonded)} IMD still in bonds.` : ''}`
    : 'No promises yet.';
  box.innerHTML = `<b>${esc(whose)}</b>: ${record} <a href="${config.explorer}/address/${wallet}" target="_blank" rel="noopener">On the explorer</a> · <a href="#board">Show everyone</a>`;
}

function render() {
  const cards = $('#cards');
  const wallet = walletId();
  const shown = wallet ? state.promises.filter((p) => p.maker.toLowerCase() === wallet) : state.promises;
  renderWallet(wallet, shown);
  let html;
  if (!shown.length) {
    html = wallet ? "<p class='empty'>This wallet hasn't made a promise yet.</p>" : '<p class="empty">No promises yet. Be the first to mean it.</p>';
  } else {
    html = shown.map((p) => {
      const d = describe(p);
      const token = state.tokens[p.token.toLowerCase()];
      const status = STATUS[p.status];
      // A verdict that arrived since the last draw gets its moment once.
      const before = state.seen.get(p.key);
      if (before !== undefined && before !== status && (status === 'Kept' || status === 'Broken')) {
        state.fresh.set(p.key, { cls: `just-${status.toLowerCase()}`, until: Date.now() + 3000 });
      }
      state.seen.set(p.key, status);
      const mark = state.fresh.get(p.key);
      const fresh = mark && Date.now() < mark.until ? mark.cls : '';
      const start = state.starts[p.key];
      const to = p.beneficiary && p.beneficiary !== ZERO ? p.beneficiary : null;
      const bar = d.running && start ? `<div class="term"><i data-term="${start},${Number(p.endTime)}"></i></div>` : '';
      return `<article class="card ${fresh}${linkedId() === p.key ? ' linked' : ''}" id="p${p.key}">
        <div class="card-head"><span class="badge ${d.badge[0]}">${d.badge[1]}</span><span class="id">#${p.id}${p.vault === 'v1' ? ' · first vault' : ''}</span><span class="shares"><button class="share" type="button" data-share="${p.key}">Copy link</button><a class="share" href="${shareOnX(p, d)}" target="_blank" rel="noopener">Share on X</a><button class="share" type="button" data-card="${p.key}" data-badge="${d.badge[1]}">Get card</button></span>${hooks(status === 'Broken' ? 'apart' : status === 'Refunded' ? 'idle' : '')}</div>
        <p class="say">${d.say}</p>
        ${bar}
        <div class="meta">
          <span>Token <b>${link('address', p.token, token?.symbol || short(p.token))}</b></span>
          <span>Bond <b>${imd(p.bond)} IMD</b></span>
          <span>Deadline <b>${new Date(Number(p.endTime) * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</b></span>
          ${to ? `<span>If broken, to <b>${link('address', to, short(to))}</b></span>` : ''}
        </div>
        ${cover(p) ? `<p class="cover">${cover(p)}</p>` : ''}
        <div class="actions"><span class="fine">${d.note}</span>${d.action ? `<button class="btn small light" data-act="${d.action[0]}" data-key="${p.key}">${d.action[1]}</button>` : ''}</div>
      </article>`;
    }).join('');
  }
  // Redraw only when something changed: replacing a card restarts whatever it was animating.
  if (html !== state.drawn) {
    state.drawn = html;
    cards.innerHTML = html;
  }
  showLinked();
  const stat =(k, v) => { $(`[data-stat="${k}"]`).textContent = v; };
  stat('made', state.total ?? 0);
  stat('kept', state.promises.filter((p) => STATUS[p.status] === 'Kept').length);
  stat('broken', state.promises.filter((p) => STATUS[p.status] === 'Broken').length);
  stat('locked', imd(state.promises.reduce((s, p) => s + p.bond, 0n)));
  renderPool();
  renderSum();
  tick();
}

const whole = (wei) => Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fine = (wei) => Number(formatUnits(wei, 18)).toLocaleString('en-US', { maximumFractionDigits: 4 });

/**
 * A running promise of the connected wallet that staking PINKY would break: one that PINKY may not
 * leave the wallet under, or must still be there at the end. A promise to pay is not one of them.
 */
function runningPinkyPromise() {
  if (!state.account || !config.token) return null;
  return state.promises.find((p) => STATUS[p.status] === 'Active' && p.kind !== 'Pay'
    && p.maker.toLowerCase() === state.account.toLowerCase() && p.token.toLowerCase() === config.token.toLowerCase()) ?? null;
}

function renderPool() {
  const { totalStaked, rewardRate, periodFinish } = state.pool;
  $('#poolTotal').textContent = `${whole(totalStaked)} PINKY`;
  const streaming = rewardRate > 0n && Date.now() / 1000 < periodFinish;
  $('#poolStream').textContent = streaming
    ? `${fine(rewardRate * 86400n)} IMD a day, until ${new Date(periodFinish * 1000).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`
    : 'Nothing right now';
  const mine = state.mine;
  $('#myStake').textContent = mine ? `${whole(mine.staked)} PINKY` : '—';
  $('#myEarned').textContent = mine ? `${fine(mine.earned)} IMD` : '—';
  // The 1% the second vault keeps from settled bonds, until someone sends it on to the pool.
  $('#feesLine').hidden = !state.fees;
  $('#feesWaiting').textContent = `${fine(state.fees)} IMD`;
  $('#poolHint').textContent = !state.account ? 'Connect a wallet to see your stake.'
    : mine ? `You have ${whole(mine.wallet)} PINKY in your wallet.` : '';
  const blocked = runningPinkyPromise();
  $('#stakeWarn').hidden = !blocked;
  if (blocked) $('#stakeWarn').textContent = blocked.kind === 'Hold'
    ? `Hold on: promise #${blocked.id} says you'll still hold PINKY at the deadline, and staking takes it out of your wallet. Wait until it's closed.`
    : `Hold on: promise #${blocked.id} says you won't move PINKY, and staking moves it out of your wallet. Stake now and you break it. Wait until it's closed.`;
  $('#stakeBtn').disabled = !!blocked;
  $('#claimBtn').disabled = !mine || mine.earned === 0n;
  $('#unstakeBtn').disabled = !!mine && mine.staked === 0n;
}

/** The connected wallet's stake, read through the wallet itself rather than the public node. */
async function readMine() {
  if (!state.account || state.preview) return;
  const [staked, earned, wallet] = await Promise.all([
    walletCall(config.staking, stakingAbi, 'balanceOf', [state.account]),
    walletCall(config.staking, stakingAbi, 'earned', [state.account]),
    walletCall(config.token, stakingAbi, 'balanceOf', [state.account]),
  ]);
  state.mine = { staked, earned, wallet };
  renderPool();
}

let reading = false;

async function refresh() {
  if (reading) return;
  reading = true;
  try {
    const more = state.preview ? (previewData(), false) : await readBoard();
    if (more) setTimeout(refresh, 2 * NODE_GAP_MS);
    render();
    if (!state.preview && await readExtras()) render();
    if (!state.preview && await readPrices().catch(() => false)) render();
    readMine().catch(() => {});
  } catch (e) {
    if (!state.promises.length) $('#cards').innerHTML = `<p class="empty">Couldn't read the chain: ${esc(e.message)}. Try again in a minute.</p>`;
  } finally {
    reading = false;
  }
}

/** While something on the board can still change, look again every so often. */
function watch() {
  const open = state.promises.some((p) => ['Active', 'Closed', 'Asked'].includes(STATUS[p.status]) || (!p.paid && ['Kept', 'Broken'].includes(STATUS[p.status])));
  if (open && !document.hidden) refresh();
}

// ───────────────────────── wallet ─────────────────────────

const chainHex = `0x${config.chainId.toString(16)}`;

// Every wallet extension wants to be `window.ethereum`, and with two installed the last one to load
// wins. EIP-6963 lets each announce itself instead, so the visitor picks.
const wallets = new Map();
window.addEventListener('eip6963:announceProvider', (ev) => {
  const { info, provider } = ev.detail ?? {};
  if (info?.uuid && provider) wallets.set(info.uuid, { info, provider });
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

/** The wallet in use. Set by `connect`; everything that signs or reads through a wallet goes here. */
let ethereum = null;

/**
 * Resolves with the wallet to use. With `manage` (someone is already connected) the list always
 * opens, so they can switch, and it carries a Disconnect button that resolves with null.
 */
function chooseWallet(manage = false) {
  const found = [...wallets.values()];
  if (!manage) {
    if (found.length === 0) {
      if (!window.ethereum) throw new Error('No wallet found in this browser.');
      return Promise.resolve(window.ethereum);
    }
    if (found.length === 1) return Promise.resolve(found[0].provider);
  }
  return new Promise((resolve, reject) => {
    const dialog = $('#wallets');
    const list = $('#walletList');
    $('#walletsTitle').textContent = manage ? 'Your wallet' : 'Which wallet?';
    const off = $('#walletOff');
    off.hidden = !manage;
    off.textContent = manage ? `Disconnect ${short(state.account)}` : '';
    off.onclick = () => { dialog.close('picked'); resolve(null); };
    list.replaceChildren(...found.map(({ info, provider }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wallet';
      const name = String(info.name ?? 'Wallet');
      // A wallet without a usable icon gets its initial, so the list lines up either way.
      const initial = document.createElement('span');
      initial.className = 'wallet-initial';
      initial.textContent = name.trim().charAt(0).toUpperCase();
      // The standard asks for a data URI; some wallets hand over an https address instead.
      const icon = String(info.icon ?? '').trim();
      if (/^(data:image\/|https:\/\/)/i.test(icon)) {
        const img = document.createElement('img');
        img.alt = '';
        img.onerror = () => img.replaceWith(initial);
        img.src = icon;
        btn.append(img);
      } else {
        btn.append(initial);
      }
      btn.append(document.createTextNode(name));
      btn.onclick = () => { dialog.close('picked'); resolve(provider); };
      return btn;
    }));
    dialog.onclose = () => {
      if (dialog.returnValue === 'picked') return;
      // Closing the list while connected is not a failure, so nothing should be reported.
      reject(Object.assign(new Error('No wallet chosen.'), { silent: manage }));
    };
    dialog.returnValue = '';
    dialog.showModal();
  });
}

function onAccounts(accounts) {
  state.account = accounts[0] ? getAddress(accounts[0]) : null;
  state.mine = null;
  $('#connect').textContent = state.account ? short(state.account) : 'Connect wallet';
  // The form's preview is about this wallet's holdings: look again. The board too, since a maker
  // may close their own promise before anyone else.
  lookUpToken(true);
  render();
  readMine().catch(() => {});
}

async function disconnect() {
  const old = ethereum;
  old?.removeListener?.('accountsChanged', onAccounts);
  ethereum = null;
  onAccounts([]);
  // Ask the wallet to forget this site as well. Not every wallet knows how, and that is fine:
  // the page has let go either way.
  try { await old?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); } catch { /* unsupported */ }
}

async function connect() {
  const chosen = await chooseWallet(!!state.account);
  if (chosen === null) return disconnect();
  if (ethereum && ethereum !== chosen) ethereum.removeListener?.('accountsChanged', onAccounts);
  ethereum = chosen;
  const [account] = await ethereum.request({ method: 'eth_requestAccounts' });
  ethereum.removeListener?.('accountsChanged', onAccounts);
  ethereum.on?.('accountsChanged', onAccounts);
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: chainHex, chainName: config.chainName, rpcUrls: [config.rpc], blockExplorerUrls: [config.explorer],
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    }] });
  }
  onAccounts([account]);
  return state.account;
}

const walletCall = async (to, abi, functionName, args = []) => decodeFunctionResult({
  abi, functionName, data: await ethereum.request({ method: 'eth_call', params: [{ to, data: encodeFunctionData({ abi, functionName, args }) }, 'latest'] }),
});

async function send(to, abi, functionName, args) {
  const hash = await ethereum.request({ method: 'eth_sendTransaction', params: [{ from: state.account, to, data: encodeFunctionData({ abi, functionName, args }) }] });
  for (let i = 0; i < 120; i++) {
    const r = await ethereum.request({ method: 'eth_getTransactionReceipt', params: [hash] });
    if (r) {
      if (r.status !== '0x1') throw new Error('The transaction was reverted.');
      return hash;
    }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error('No receipt yet. Check your wallet for the transaction.');
}

const readable = (e) => e?.shortMessage || e?.message || String(e);

/** The big hooks behind the headline pull tight for a moment. */
function squeeze() {
  const bg = $('.hero-hooks');
  bg.classList.remove('squeeze');
  void bg.getBoundingClientRect();
  bg.classList.add('squeeze');
}

// ───────────────────────── actions ─────────────────────────

// "Make a promise" in the menu: go to the form only if it is not already in view, then start typing.
document.querySelector('nav a[href="#make"]').addEventListener('click', (ev) => {
  ev.preventDefault();
  const form = $('#form');
  const box = form.getBoundingClientRect();
  if (box.top < 70 || box.bottom > innerHeight) form.scrollIntoView({ block: 'center' });
  form.elements.token.focus({ preventScroll: true });
});

$('#connect').onclick = () => connect().catch((e) => {
  if (e.silent) return;
  $('#formMsg').textContent = readable(e);
  $('#formMsg').className = 'msg bad';
});

// A promise has its own address. /p/2/ is a small page with that promise's link preview, built by
// tools/build-previews.mjs; it sends people on to /#p2, which opens the board at that card. The
// second vault's promises are /p/v2-1/ and /#pv2-1.
const promiseUrl = (key) => `${location.origin}/p/${key}/`;
function linkedId() {
  const m = /^#p((?:v2-)?\d+)$/.exec(location.hash);
  return m ? m[1] : null;
}
let shownLinked = null;
function showLinked() {
  const id = linkedId();
  const card = id && document.getElementById(`p${id}`);
  if (!card || shownLinked === id) return;
  shownLinked = id;
  // Jump, don't glide: the visitor came for this card, and a background tab never finishes a glide.
  card.scrollIntoView({ block: 'center', behavior: 'instant' });
}
window.addEventListener('hashchange', () => {
  shownLinked = null;
  render();
  showLinked();
  if (walletId()) $('#board').scrollIntoView({ block: 'start', behavior: 'instant' });
});

$('#cards').addEventListener('click', async (ev) => {
  const share = ev.target.closest('button[data-share]');
  if (share) {
    const url = promiseUrl(share.dataset.share);
    try {
      await navigator.clipboard.writeText(url);
      share.textContent = 'Copied';
    } catch {
      // No clipboard permission: put the address in the bar, where it can be copied by hand.
      history.replaceState(null, '', url);
      share.textContent = 'Link is in the address bar';
    }
    setTimeout(() => { share.textContent = 'Copy link'; }, 2000);
    return;
  }
  const get = ev.target.closest('button[data-card]');
  if (get) {
    // The card is drawn by tools/build-previews.mjs every twenty minutes, so a new one may not exist yet.
    const name = `card-${get.dataset.badge.toLowerCase().replace(/[^a-z]+/g, '-')}.png`;
    const url = `/p/${get.dataset.card}/${name}`;
    const ok = await fetch(url, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
    if (ok) {
      const a = Object.assign(document.createElement('a'), { href: url, download: `pinky-promise-${get.dataset.card}.png` });
      a.click();
    } else {
      get.textContent = 'Card is still being drawn, try in 20 minutes';
      setTimeout(() => { get.textContent = 'Get card'; }, 3000);
    }
    return;
  }
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  if (state.preview) { btn.textContent = 'Preview only'; return; }
  const p = state.promises.find((x) => x.key === btn.dataset.key);
  if (!p) return;
  const label = btn.textContent;
  btn.disabled = true;
  try {
    if (!state.account) await connect();
    btn.textContent = 'Confirm in your wallet…';
    const [to, abi] = p.vault === 'v2' ? [config.vault2, vault2Abi] : [config.vault, vaultAbi];
    await send(to, abi, btn.dataset.act, [BigInt(p.id)]);
    btn.textContent = 'Done';
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    // The oracle wants the closing block confirmed: an ask right after the close is refused.
    const soon = STATUS[p.status] === 'Closed' ? ' If it closed a moment ago, wait a few seconds and try again.' : '';
    btn.parentElement.querySelector('.fine').textContent = readable(e) + soon;
  }
});

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = (text, bad = false) => { $('#formMsg').textContent = text; $('#formMsg').className = bad ? 'msg bad' : 'msg'; };
  if (state.preview) return msg('The contracts are not live yet, so this form is switched off.', true);
  const f = ev.target.elements;
  const kind = formKind();
  const token = f.token.value.trim();
  if (!isAddress(token)) return msg("That doesn't look like a token address.", true);
  // The bond itself leaves the wallet in IMD, inside the window, so the vault refuses this one.
  if (kind === 'Keep' && token.toLowerCase() === config.imd.toLowerCase()) return msg("A promise not to move IMD can't be judged: the bond itself leaves your wallet in IMD.", true);
  const target = f.target.value.trim();
  if (kind === 'Pay' && !isAddress(target)) return msg("Say who you'll pay: their address.", true);
  const named = f.beneficiary.value.trim();
  if (named && !isAddress(named)) return msg("The address the bond would go to doesn't look right.", true);
  const seconds = Math.round(Number(f.duration.value) * Number(f.unit.value));
  if (!(seconds >= 600 && seconds <= 2592000)) return msg('Pick a term between 10 minutes and 30 days.', true);
  $('#submit').disabled = true;
  try {
    if (!state.account) await connect();
    const me = state.account.toLowerCase();
    if (kind === 'Pay' && target.toLowerCase() === me) throw new Error("Paying yourself doesn't prove anything. Name someone else.");
    // A promise to pay someone is made to them, unless the form names someone else.
    const beneficiary = named ? getAddress(named) : kind === 'Pay' ? getAddress(target) : ZERO;
    if (beneficiary.toLowerCase() === me) throw new Error("The bond can't go to you if you break your word. Name someone else, or leave it empty.");
    // An ordinary token says how many decimals it has; an NFT does not. Both questions the form
    // asks sum transfer amounts, which NFTs do not have, so a promise about one would be judged
    // on nothing.
    let decimals;
    try {
      decimals = Number(await walletCall(token, erc20Abi, 'decimals'));
    } catch {
      throw new Error("That address isn't an ordinary token. NFTs come soon.");
    }
    const amount = parseUnits(f.maxOut.value.trim() || '0', decimals);
    if (kind === 'Pay' && amount === 0n) throw new Error('Say how much you\'ll send.');
    const bond = parseUnits(f.bond.value.trim(), 18);
    if (bond < state.minBond) throw new Error(`The bond has to be at least ${imd(state.minBond)} IMD.`);
    const allowed = await walletCall(config.imd, erc20Abi, 'allowance', [state.account, config.vault2]);
    if (allowed < bond) {
      msg('Step 1 of 2: let the vault take the bond. Confirm in your wallet…');
      await send(config.imd, erc20Abi, 'approve', [config.vault2, bond]);
    }
    msg('Step 2 of 2: make the promise. Confirm in your wallet…');
    await send(config.vault2, vault2Abi, 'make', [
      KINDS.indexOf(kind), getAddress(token), amount, kind === 'Pay' ? getAddress(target) : ZERO, beneficiary, BigInt(seconds), bond,
    ]);
    msg("It's on the board. Now keep it.");
    squeeze();
    ev.target.reset();
    $('#toSomeone').open = false;
    onKind();
    lookUpToken(true);
    renderSum();
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    msg(readable(e), true);
  } finally {
    $('#submit').disabled = false;
  }
});

// Stake, unstake, claim.
async function poolAction(kind) {
  const msg = (text, bad = false) => { $('#poolMsg').textContent = text; $('#poolMsg').className = bad ? 'msg bad' : 'msg'; };
  if (state.preview) return msg('The contracts are not live yet, so this is switched off.', true);
  try {
    if (!state.account) await connect();
    await readMine();
    if (kind === 'claim') {
      msg('Confirm in your wallet…');
      await send(config.staking, stakingAbi, 'claim', []);
      msg('Claimed. The IMD is in your wallet.');
    } else {
      const text = $('#stakeAmount').value.trim().replace(/[\s,]/g, '');
      if (!/^\d+(\.\d+)?$/.test(text) || Number(text) === 0) return msg('Enter how many PINKY.', true);
      const amount = parseUnits(text, 18);
      if (kind === 'stake') {
        if (runningPinkyPromise()) return msg("You have a running promise about PINKY. Staking now would break it.", true);
        if (amount > state.mine.wallet) return msg(`You have ${whole(state.mine.wallet)} PINKY in your wallet.`, true);
        const allowed = await walletCall(config.token, erc20Abi, 'allowance', [state.account, config.staking]);
        if (allowed < amount) {
          msg('Step 1 of 2: let the pool take the tokens. Confirm in your wallet…');
          await send(config.token, erc20Abi, 'approve', [config.staking, amount]);
        }
        msg('Step 2 of 2: stake. Confirm in your wallet…');
        await send(config.staking, stakingAbi, 'stake', [amount]);
        msg('Staked. Take it back whenever you like.');
      } else {
        if (amount > state.mine.staked) return msg(`You have ${whole(state.mine.staked)} PINKY staked.`, true);
        msg('Confirm in your wallet…');
        await send(config.staking, stakingAbi, 'unstake', [amount]);
        msg('Back in your wallet.');
      }
      $('#stakeAmount').value = '';
    }
    await readMine();
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    msg(readable(e), true);
  }
}
for (const kind of ['stake', 'unstake', 'claim']) $(`#${kind}Btn`).onclick = () => poolAction(kind);
$('#sendFees').onclick = async () => {
  const btn = $('#sendFees');
  try {
    if (!state.account) await connect();
    btn.disabled = true;
    btn.textContent = 'Confirm in your wallet…';
    await send(config.vault2, vault2Abi, 'sendFees', []);
    btn.textContent = 'Sent';
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    btn.textContent = 'Send them to stakers';
    $('#poolMsg').textContent = readable(e);
    $('#poolMsg').className = 'msg bad';
  } finally {
    btn.disabled = false;
  }
};

// What the form knows about the token being typed: its name and decimals, and, with a wallet
// connected, how much of it that wallet holds.
const draft = { token: '', meta: null, held: null, bad: false };
let draftTimer = null;

const parseAmount = (text, decimals) => {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  try { return parseUnits(clean, decimals); } catch { return null; }
};

/** Looks the typed token up, a moment after the typing stops. */
function lookUpToken(force = false) {
  const token = $('#form').elements.token.value.trim().toLowerCase();
  clearTimeout(draftTimer);
  if (!force && token === draft.token && (draft.meta || draft.bad)) return;
  Object.assign(draft, { token, meta: state.tokens[token] ?? null, held: null, bad: false });
  if (!isAddress(token) || state.preview) return;
  draftTimer = setTimeout(async () => {
    try {
      if (!draft.meta) {
        // Through the wallet when there is one; the public node only as a fallback, once per token.
        const calls = [{ to: token, abi: erc20Abi, functionName: 'symbol' }, { to: token, abi: erc20Abi, functionName: 'decimals' }];
        const [symbol, decimals] = state.account
          ? await Promise.all(calls.map((c) => walletCall(c.to, c.abi, c.functionName).catch(() => null)))
          : await nodeBatch(calls);
        if (draft.token !== token) return;
        if (decimals === null) { draft.bad = true; return renderSum(); }
        draft.meta = state.tokens[token] = { symbol: symbol ?? '', decimals: Number(decimals) };
        localStorage.setItem('pinky.tokens', JSON.stringify(state.tokens));
      }
      if (state.account) draft.held = await walletCall(token, erc20Abi, 'balanceOf', [state.account]).catch(() => null);
      if (draft.token !== token) return;
      renderSum();
      if (!state.prices[token] && await fetchPrices([token]).catch(() => false) && draft.token === token) renderSum();
    } catch { /* the preview just stays shorter */ }
  }, 600);
}

/** Which kind of promise the form is making: Keep or Pay for now. */
const formKind = () => KINDS[Number($('#form').elements.kind.value)] ?? 'Keep';

/** The form's words follow the kind: what the token is for, and what the amount means. */
function onKind() {
  const f = $('#form').elements;
  const pay = formKind() === 'Pay';
  $('#tokenLabel').textContent = pay ? "Token you'll send" : "Token you won't move";
  $('#amountLabel').textContent = pay ? 'At least this many to them' : 'At most this many tokens out';
  $('#toField').hidden = !pay;
  f.target.required = pay;
  // "None out" is the usual promise to keep; a payment starts from nothing.
  if (pay && f.maxOut.value === '0') f.maxOut.value = '';
  if (!pay && f.maxOut.value === '') f.maxOut.value = '0';
  f.maxOut.placeholder = pay ? '1000' : '0';
  f.beneficiary.placeholder = pay ? 'Empty: the person you pay' : '0x…';
  $('#toSomeoneHint').textContent = pay
    ? "Leave it empty and the bond goes to the person you pay if you don't."
    : 'Leave it empty and a broken bond is split: a tenth to whoever asks first, the rest between PINKY stakers and a burn.';
  renderSum();
}

/** Who a broken promise would pay, as the form stands: a typed address, or for Pay the payee. */
function formBeneficiary() {
  const f = $('#form').elements;
  const named = f.beneficiary.value.trim();
  if (isAddress(named)) return named;
  if (formKind() === 'Pay' && isAddress(f.target.value.trim())) return f.target.value.trim();
  return null;
}

/**
 * Under the bond field: the promise in words, what is locked and what comes back, and how the
 * bond compares with what the wallet holds — the same sentence the board will show.
 */
function renderSum() {
  const box = $('#formSum');
  const f = $('#form').elements;
  const kind = formKind();
  const least = state.minBond > state.fee * 3n ? state.minBond : state.fee * 3n;
  const bond = parseAmount(f.bond.value, 18);
  const to = formBeneficiary();
  const lines = [];
  const count = (wei) => Number(formatUnits(wei, draft.meta.decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const tokens = (wei) => `${count(wei)} ${esc(draft.meta.symbol || 'tokens')}`;

  if (draft.bad) {
    lines.push("That address isn't an ordinary token. NFTs come soon.");
  } else if (draft.meta) {
    const amount = parseAmount(f.maxOut.value || '0', draft.meta.decimals);
    const n = Number(f.duration.value);
    const unit = { 60: 'minute', 3600: 'hour', 86400: 'day' }[f.unit.value];
    const span = n > 0 && unit ? `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}` : '';
    const target = f.target.value.trim();
    if (kind === 'Pay' && amount) {
      const whom = isAddress(target) ? short(target) : 'them';
      lines.push(`<span class="sum-say">“I'll send at least ${tokens(amount)} to <span class="nowrap">${esc(whom)}</span>${span ? ` within ${span}` : ''}.”</span>`);
    } else if (kind === 'Keep' && amount !== null) {
      const limit = amount === 0n ? `a single ${esc(draft.meta.symbol || 'token')}` : `more than ${tokens(amount)}`;
      lines.push(`<span class="sum-say">“I won't move ${limit}${span ? ` for ${span}` : ''}.”</span>`);
    }
  }

  if (bond === null || bond === 0n) {
    lines.push(`The smallest bond is <b>${imd(least)} IMD</b>. Settling a promise costs <b>${imd(state.fee)} IMD</b> for the oracle's question, paid out of the bond.`);
  } else if (bond < least) {
    lines.push(`That's under the smallest bond, <b>${imd(least)} IMD</b>.`);
  } else {
    // The second vault takes 1% of a bond that goes home or to the person it was made to.
    const left = bond - state.fee;
    const home = left - left * FEE_BPS / 10_000n;
    const broken = to ? `Break it and <b>${imd(home)} IMD</b> goes to <span class="nowrap">${esc(short(to))}</span>.` : 'Break it and none comes back.';
    lines.push(`You lock <b>${imd(bond)} IMD</b>; the oracle's question takes <b>${imd(state.fee)}</b> of it. Keep your word and <b>${imd(home)} IMD</b> comes home, after 1% for PINKY stakers. ${broken}`);
  }

  if (draft.meta && !draft.bad) {
    const amount = parseAmount(f.maxOut.value || '0', draft.meta.decimals) ?? 0n;
    if (!state.account) {
      lines.push(kind === 'Pay' ? 'Connect a wallet to see whether you hold enough to pay.' : 'Connect a wallet to see how the bond compares with what you hold.');
    } else if (draft.held !== null && kind === 'Pay') {
      if (amount > 0n && draft.held < amount) lines.push(`<b>Your wallet holds ${tokens(draft.held)}</b> right now. You'll need ${tokens(amount)} by the deadline.`);
    } else if (draft.held !== null) {
      const atStake = draft.held > amount ? draft.held - amount : 0n;
      const tokenUsd = state.prices[draft.token];
      const imdUsd = state.prices[config.imd.toLowerCase()];
      const shown = tokens(atStake);
      if (atStake === 0n) {
        lines.push(draft.held === 0n
          ? '<b>Your wallet holds none of this token</b>, so the promise would have nothing to break.'
          : '<b>Your wallet holds no more than the limit</b>, so the promise would have nothing to break.');
      } else if (bond && bond >= least && tokenUsd && imdUsd) {
        const stakeUsd = Number(formatUnits(atStake, draft.meta.decimals)) * tokenUsd;
        const share = (Number(formatUnits(bond, 18)) * imdUsd) / stakeUsd;
        const dollars = stakeUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: stakeUsd < 100 ? 2 : 0 });
        const pct = share < 0.01 ? 'less than 1%' : `${Math.round(share * 100)}%`;
        lines.push(share >= 1
          ? `The bond is worth <b>more than</b> the ${shown} you could move, about ${dollars}.`
          : `The bond is worth <b>${pct}</b> of the ${shown} you could move, about ${dollars}. The board will say so.`);
      } else if (!tokenUsd) {
        lines.push(`You could move ${shown}. There's no market price for it, so the board can't weigh the bond against that.`);
      }
    }
  }
  box.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
}

for (const name of ['bond', 'maxOut', 'duration', 'unit', 'target', 'beneficiary']) $('#form').elements[name].addEventListener('input', renderSum);
for (const radio of $('#form').elements.kind) radio.addEventListener('change', onKind);
$('#form').elements.token.addEventListener('input', () => { lookUpToken(); renderSum(); });

// Where to get the token, and its address to check against whatever the swap page shows.
$('.get').hidden = !config.token || !config.buy;
$('#buy').href = config.buy;
$('#buyTop').href = config.buy;
$('#buyTop').hidden = $('.get').hidden;
$('#verified').href = config.verified;
$('#getImd').href = config.buyImd;
$('#needImd').hidden = !config.buyImd;
$('#copyToken').onclick = async () => {
  const btn = $('#copyToken');
  try {
    await navigator.clipboard.writeText(config.token);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = config.token;
  }
  setTimeout(() => { btn.textContent = 'Copy token address'; }, 2500);
};

// ───────────────────────── start ─────────────────────────

if (state.preview) {
  $('#notice').hidden = false;
  $('#notice').textContent = 'Preview. The contracts are being launched; the promises below are examples, not real ones.';
}
const rows = [['Vault', config.vault2], ['First vault', config.vault], ['Staking', config.staking], ['PINKY', config.token], ['IMD', config.imd]].filter(([, a]) => a);
$('#addresses').innerHTML = rows.map(([k, a]) => `<dt>${k}</dt><dd><a href="${config.explorer}/address/${a}" target="_blank" rel="noopener">${a}</a></dd>`).join('');
$('#gh').href = config.github;
if (config.x) {
  const x = $('#xl a');
  x.href = config.x;
  x.textContent = `@${config.x.split('/').pop()}`;
  $('#xl').hidden = false;
}
refresh();
setInterval(tick, 1000);
setInterval(watch, state.preview ? 4000 : 30000);
