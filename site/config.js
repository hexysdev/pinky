// IMD launch #1166. With `vault` empty the page shows preview data.
export const config = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  imd: '0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127',
  // The first vault (launch #1166). Its promises stay on the board; new ones go to vault2.
  vault: '0x3c81384aa1ca064316576a214e2fb30969992772',
  // The second vault (launch #1840): four kinds of promise, made to someone if you like.
  vault2: '0x35fc6223307b55814a1a7a1b07c9c00d88e2b55c',
  staking: '0x17fb2067652bcf4803e937cf323a248ff6b7cba3',
  token: '0xb125c461c00863aacad4cc99311d2f23d4342a6f',
  // Where the second vault buys the oracle's answer (Intake v2), to show what a question costs
  // before anyone signs. The first vault still asks Intake v1, at the same price.
  intake: '0xa43e6f75ee006411f79ac1c84120606c2330de82',
  oracleAction: '0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000',
  // Opens Uniswap on Robinhood Chain with ETH → PINKY filled in.
  buy: 'https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=0xb125c461c00863aacad4cc99311d2f23d4342a6f',
  // The same for IMD, which every bond is paid in.
  buyImd: 'https://app.uniswap.org/swap?chain=robinhood&inputCurrency=NATIVE&outputCurrency=0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127',
  verified: 'https://repo.sourcify.dev/4663/0xb125c461c00863aacad4cc99311d2f23d4342a6f',
  github: 'https://github.com/hexysdev/pinky',
  // The footer shows this link only when it is set.
  x: 'https://x.com/pinkybond_fun',
};
