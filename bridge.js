require('dotenv').config();
const { ethers } = require('ethers');

const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const T1_NETWORK = process.env.T1_NETWORK;
const BRIDGE_ADDRESS = process.env.BRIDGE_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AMOUNT_TO_DEPOSIT = process.env.AMOUNT_TO_DEPOSIT;
const L2_GAS_LIMIT = parseInt(process.env.L2_GAS_LIMIT);
const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINUTES);

const abi = [
  "function depositETH(uint32 l2Gas, bytes calldata data) payable"
];

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const bridgeContract = new ethers.Contract(BRIDGE_ADDRESS, abi, wallet);

async function bridgeETH() {
  try {
    const amount = ethers.parseEther(AMOUNT_TO_DEPOSIT);
    const tx = await bridgeContract.depositETH(
      L2_GAS_LIMIT,
      '0x',
      { value: amount }
    );

    console.log(`Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Tx confirmed in block ${receipt.blockNumber}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

async function startLoop() {
  while (true) {
    console.log(`Bridging ${AMOUNT_TO_DEPOSIT} ETH to T1...`);
    await bridgeETH();
    console.log(`Waiting ${INTERVAL_MINUTES} minutes for next bridge...`);
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MINUTES * 60 * 1000));
  }
}

startLoop();
