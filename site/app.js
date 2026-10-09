import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, isAddress, parseUnits } from 'https://esm.sh/viem@2.57.4';
import { config } from './config.js';

const $ = (sel) => document.querySelector(sel);
const STATUS = ['Active', 'Closed', 'Asked', 'Kept', 'Broken', 'Refunded'];
const PAGE = 40;
// The public node allows about one request every seven seconds per address.
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
const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

const state = { account: null, promises: [], minBond: 5n * 10n ** 18n, tokens: loadTokens(), preview: !config.vault };

// ───────────────────────── reading ─────────────────────────

function loadTokens() {
  try { return JSON.parse(localStorage.getItem('pinky.tokens') ?? '{}'); } catch { return {}; }
}

async function nodeBatch(calls) {
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: c.to, data: encodeFunctionData(c) }, 'latest'] }));
  const res = await fetch(config.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`the node answered ${res.status}`);
  const byId = new Map((await res.json()).map((r) => [r.id, r]));
  return calls.map((c, i) => {
    const r = byId.get(i);
    if (!r || r.error || !r.result || r.result === '0x') return null;
    try { return decodeFunctionResult({ abi: c.abi, functionName: c.functionName, data: r.result }); } catch { return null; }
  });
}

async function readBoard() {
  const vault = { to: config.vault, abi: vaultAbi };
  const calls = [{ ...vault, functionName: 'count' }, { ...vault, functionName: 'minBond' }];
  for (let id = 1; id <= PAGE; id++) calls.push({ ...vault, functionName: 'promises', args: [BigInt(id)] });
  const [count, minBond, ...rows] = await nodeBatch(calls);
  if (count === null) throw new Error('the vault did not answer');
  if (minBond) state.minBond = minBond;
  const keys = vaultAbi[2].outputs.map((o) => o.name);
  state.promises = rows.slice(0, Number(count)).map((row, i) => row && { id: i + 1, ...Object.fromEntries(keys.map((k, j) => [k, row[j]])) }).filter(Boolean).reverse();
  state.total = Number(count);
}

async function readTokens() {
  const unknown = [...new Set(state.promises.map((p) => p.token.toLowerCase()))].filter((t) => !state.tokens[t]);
  if (!unknown.length) return;
  await new Promise((ok) => setTimeout(ok, NODE_GAP_MS));
  const calls = unknown.flatMap((to) => [{ to, abi: erc20Abi, functionName: 'symbol' }, { to, abi: erc20Abi, functionName: 'decimals' }]);
  const out = await nodeBatch(calls);
  unknown.forEach((t, i) => {
    if (out[2 * i + 1] !== null) state.tokens[t] = { symbol: out[2 * i] ?? '', decimals: Number(out[2 * i + 1]) };
  });
  localStorage.setItem('pinky.tokens', JSON.stringify(state.tokens));
}

function previewData() {
  const now = Math.floor(Date.now() / 1000);
  const t = '0x00000000000000000000000000000000000a11ce';
  state.tokens[t] = { symbol: 'MEME', decimals: 18 };
  const base = { token: t, attempts: 1, paid: false, asker: '0x0000000000000000000000000000000000000000', observedOut: 0n };
  const e18 = 10n ** 18n;
  state.promises = [
    { ...base, id: 4, maker: '0x1111111111111111111111111111111111111111', maxOut: 0n, bond: 20n * e18, endTime: now + 1500, status: 0, attempts: 0 },
    { ...base, id: 3, maker: '0x2222222222222222222222222222222222222222', maxOut: 1000000n * e18, bond: 95n * e18 / 10n, endTime: now - 300, status: 2 },
    { ...base, id: 2, maker: '0x3333333333333333333333333333333333333333', maxOut: 0n, bond: 0n, endTime: now - 7200, status: 3, paid: true },
    { ...base, id: 1, maker: '0x4444444444444444444444444444444444444444', maxOut: 5000000n * e18, bond: 0n, endTime: now - 90000, status: 4, paid: true, observedOut: 48000000n * e18 },
  ];
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

function when(ts) {
  const d = Number(ts) - Date.now() / 1000;
  const abs = Math.abs(d);
  const unit = abs < 3600 ? [60, 'min'] : abs < 172800 ? [3600, 'h'] : [86400, 'd'];
  const n = Math.max(1, Math.round(abs / unit[0]));
  return d > 0 ? `in ${n} ${unit[1]}` : `${n} ${unit[1]} ago`;
}

function describe(p) {
  const now = Date.now() / 1000;
  const over = now >= Number(p.endTime);
  const limit = p.maxOut === 0n ? 'a single token' : `more than ${amount(p, p.maxOut)}`;
  const tokenName = state.tokens[p.token.toLowerCase()]?.symbol;
  const of = p.maxOut === 0n && tokenName ? ` of ${esc(tokenName)}` : '';
  const say = `<span class="who">${link('address', p.maker, short(p.maker))}</span> ${over ? 'promised not to move' : "won't move"} ${limit}${of}.`;
  switch (STATUS[p.status]) {
    case 'Active':
      return over
        ? { say, badge: ['waiting', 'Time is up'], note: 'Anyone can close it now.', action: ['close', 'Close it'] }
        : { say, badge: ['waiting', 'Running'], note: `Ends ${when(p.endTime)}.` };
    case 'Closed':
      return { say, badge: ['waiting', 'Closed'], note: 'Ready for the oracle. Asking costs the bond 0.5 IMD.', action: ['ask', 'Ask the oracle'] };
    case 'Asked':
      return { say, badge: ['waiting', 'Counting'], note: `The swarm is counting. Attempt ${p.attempts} of 3.` };
    case 'Kept':
      return { say, badge: ['kept', 'Kept'], note: p.paid ? 'Kept their word. The bond went home.' : 'Kept their word. The bond is ready to go home.', action: p.paid ? null : ['payout', 'Send it home'] };
    case 'Broken':
      return { say, badge: ['broken', 'Broken'], note: `They moved ${amount(p, p.observedOut)}. ${p.paid ? 'The bond is gone.' : 'The bond is forfeit.'}`, action: p.paid ? null : ['payout', 'Split the bond'] };
    default:
      return { say, badge: ['quiet', 'No answer'], note: 'The oracle gave no answer, so the bond was returned.' };
  }
}

function render() {
  const cards = $('#cards');
  if (!state.promises.length) {
    cards.innerHTML = '<p class="empty">No promises yet. Be the first to mean it.</p>';
  } else {
    cards.innerHTML = state.promises.map((p) => {
      const d = describe(p);
      const token = state.tokens[p.token.toLowerCase()];
      return `<article class="card">
        <div class="card-head"><span class="badge ${d.badge[0]}">${d.badge[1]}</span><span class="id">#${p.id}</span></div>
        <p class="say">${d.say}</p>
        <div class="meta">
          <span>Token <b>${link('address', p.token, token?.symbol || short(p.token))}</b></span>
          <span>Bond <b>${imd(p.bond)} IMD</b></span>
          <span>Deadline <b>${new Date(Number(p.endTime) * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</b></span>
        </div>
        <div class="actions"><span class="fine">${d.note}</span>${d.action ? `<button class="btn small light" data-act="${d.action[0]}" data-id="${p.id}">${d.action[1]}</button>` : ''}</div>
      </article>`;
    }).join('');
  }
  const stat = (k, v) => { $(`[data-stat="${k}"]`).textContent = v; };
  stat('made', state.total ?? 0);
  stat('kept', state.promises.filter((p) => STATUS[p.status] === 'Kept').length);
  stat('broken', state.promises.filter((p) => STATUS[p.status] === 'Broken').length);
  stat('locked', imd(state.promises.reduce((s, p) => s + p.bond, 0n)));
}

async function refresh() {
  try {
    if (state.preview) previewData(); else await readBoard();
    render();
    if (!state.preview) { await readTokens(); render(); }
  } catch (e) {
    $('#cards').innerHTML = `<p class="empty">Couldn't read the chain: ${esc(e.message)}. Try again in a minute.</p>`;
  }
}

// ───────────────────────── wallet ─────────────────────────

const chainHex = `0x${config.chainId.toString(16)}`;

async function connect() {
  if (!window.ethereum) throw new Error('No wallet found in this browser.');
  const [account] = await ethereum.request({ method: 'eth_requestAccounts' });
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: chainHex, chainName: config.chainName, rpcUrls: [config.rpc], blockExplorerUrls: [config.explorer],
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    }] });
  }
  state.account = getAddress(account);
  $('#connect').textContent = short(state.account);
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

// ───────────────────────── actions ─────────────────────────

$('#connect').onclick = () => connect().catch((e) => { $('#formMsg').textContent = readable(e); $('#formMsg').className = 'msg bad'; });

$('#cards').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  if (state.preview) { btn.textContent = 'Preview only'; return; }
  const label = btn.textContent;
  btn.disabled = true;
  try {
    if (!state.account) await connect();
    btn.textContent = 'Confirm in your wallet…';
    await send(config.vault, vaultAbi, btn.dataset.act, [BigInt(btn.dataset.id)]);
    btn.textContent = 'Done';
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    btn.parentElement.querySelector('.fine').textContent = readable(e);
  }
});

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = (text, bad = false) => { $('#formMsg').textContent = text; $('#formMsg').className = bad ? 'msg bad' : 'msg'; };
  if (state.preview) return msg('The contracts are not live yet, so this form is switched off.', true);
  const f = ev.target.elements;
  const token = f.token.value.trim();
  if (!isAddress(token)) return msg("That doesn't look like a token address.", true);
  const seconds = Math.round(Number(f.duration.value) * Number(f.unit.value));
  if (!(seconds >= 600 && seconds <= 2592000)) return msg('Pick a term between 10 minutes and 30 days.', true);
  $('#submit').disabled = true;
  try {
    if (!state.account) await connect();
    const decimals = Number(await walletCall(token, erc20Abi, 'decimals'));
    const maxOut = parseUnits(f.maxOut.value.trim() || '0', decimals);
    const bond = parseUnits(f.bond.value.trim(), 18);
    if (bond < state.minBond) throw new Error(`The bond has to be at least ${imd(state.minBond)} IMD.`);
    const allowed = await walletCall(config.imd, erc20Abi, 'allowance', [state.account, config.vault]);
    if (allowed < bond) {
      msg('Step 1 of 2: let the vault take the bond. Confirm in your wallet…');
      await send(config.imd, erc20Abi, 'approve', [config.vault, bond]);
    }
    msg('Step 2 of 2: make the promise. Confirm in your wallet…');
    await send(config.vault, vaultAbi, 'make', [getAddress(token), maxOut, BigInt(seconds), bond]);
    msg("It's on the board. Now keep it.");
    ev.target.reset();
    setTimeout(refresh, NODE_GAP_MS);
  } catch (e) {
    msg(readable(e), true);
  } finally {
    $('#submit').disabled = false;
  }
});

// ───────────────────────── start ─────────────────────────

if (state.preview) {
  $('#notice').hidden = false;
  $('#notice').textContent = 'Preview. The contracts are being launched; the promises below are examples, not real ones.';
}
const rows = [['Vault', config.vault], ['Staking', config.staking], ['PINKY', config.token], ['IMD', config.imd]].filter(([, a]) => a);
$('#addresses').innerHTML = rows.map(([k, a]) => `<dt>${k}</dt><dd><a href="${config.explorer}/address/${a}" target="_blank" rel="noopener">${a}</a></dd>`).join('');
$('#gh').href = config.github;
$('#xl').href = config.x;
refresh();
