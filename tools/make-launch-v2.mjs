// Builds the two transactions that pay for the second vault's launch on Robinhood Chain:
// approve Intake v2 for 0.5 IMD, then request launch.open@launch-1 with the body in
// requests/launch-v2.input.json. No callback: the launch is followed by transaction hash.
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeFunctionData, stringToHex } from 'viem';

const OWNER = '0x89d6584e733ece619c9c34f9a370e1dff5ecf8ef';
const IMD = '0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127';
const INTAKE = '0xa43e6f75ee006411f79ac1c84120606c2330de82';
const ACTION = '0x6c61756e63682e6f70656e406c61756e63682d31000000000000000000000000'; // launch.open@launch-1
const PRICE = 500000000000000000n;

const json = JSON.stringify(JSON.parse(readFileSync(new URL('../requests/launch-v2.input.json', import.meta.url), 'utf8')));
const erc20 = [{ type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }];
const intake = [{ type: 'function', name: 'request', stateMutability: 'nonpayable', outputs: [{ type: 'bytes32' }], inputs: [
  { type: 'bytes32' }, { type: 'bytes' }, { type: 'tuple', components: [{ name: 'target', type: 'address' }, { name: 'selector', type: 'bytes4' }] }, { type: 'address' }, { type: 'uint256' },
] }];
writeFileSync(new URL('launch-v2.calldata.json', import.meta.url), JSON.stringify({
  title: 'Launch the second vault',
  intro: 'Pays the IdentityMD swarm 0.5 IMD on Robinhood Chain to audit, adapt, test and deploy PinkyVaultV2. Two transactions, both signed in your wallet.',
  chainId: 4663, from: OWNER, imd: IMD, intake: INTAKE,
  approve: encodeFunctionData({ abi: erc20, functionName: 'approve', args: [INTAKE, PRICE] }),
  request: encodeFunctionData({ abi: intake, functionName: 'request', args: [ACTION, stringToHex(json), { target: '0x0000000000000000000000000000000000000000', selector: '0x00000000' }, IMD, PRICE] }),
  expectedTitle: 'What it buys',
  expectedLabel: 'launch.open@launch-1, contracts only (evm_contracts), PinkyVaultV2 from commit 778eeaa, owner 0x89d6…f8ef',
  stepAsk: 'Order the launch. The Intake pulls the 0.5 IMD and the swarm starts.',
  buttonAsk: 'Order the launch',
  body: json,
}, null, 2));
console.log(json.length, 'bytes');
