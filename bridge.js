require('dotenv').config();
const { ethers } = require('ethers');

const {
  SEPOLIA_RPC,
  T1_NETWORK,
  BRIDGE_ADDRESS,
  PRIVATE_KEY,
  AMOUNT_TO_DEPOSIT,
  L2_GAS_LIMIT,
  INTERVAL_MINUTES,
} = process.env;

const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const bridgeAbi = [
  'function depositETH(uint256 l2Gas, bytes calldata data) external payable',
];

const bridgeContract = new ethers.Contract(BRIDGE_ADDRESS, bridgeAbi, wallet);

async function bridgeETH() {
  try {
    const balance = await wallet.getBalance();
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

    if (balance < ethers.parseEther(AMOUNT_TO_DEPOSIT)) {
      console.log('Not enough balance to bridge!');
      return;
    }

    const tx = await bridgeContract.depositETH(
      L2_GAS_LIMIT,
      '0x',
      {
        value: ethers.parseEther(AMOUNT_TO_DEPOSIT),
      }
    );

    console.log(`Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Tx confirmed in block ${receipt.blockNumber}`);
  } catch (error) {
    console.error('Error while bridging:', error);
  }
}

async function startLoop() {
  while (true) {
    console.log(`Starting bridge at ${new Date().toLocaleString()}`);
    await bridgeETH();
    console.log(`Waiting ${INTERVAL_MINUTES} minutes...\n`);
    await new Promise((resolve) =>
      setTimeout(resolve, INTERVAL_MINUTES * 60 * 1000)
    );
  }
}

startLoop();
