require('dotenv').config();
const { ethers } = require('ethers');

const {
  SEPOLIA_RPC,
  BRIDGE_ADDRESS,
  PRIVATE_KEY,
  AMOUNT_TO_DEPOSIT,
  INTERVAL_MINUTES,
  L2_GAS_LIMIT
} = process.env;

const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

async function sendETH() {
  try {
    const balance = await wallet.getBalance();
    const amountInWei = ethers.utils.parseEther(AMOUNT_TO_DEPOSIT);

    if (balance.lt(amountInWei)) {
      console.log(`❌ Not enough balance. Current: ${ethers.utils.formatEther(balance)} ETH`);
      return;
    }

    const tx = await wallet.sendTransaction({
      to: BRIDGE_ADDRESS,
      value: amountInWei,
      gasLimit: Number(L2_GAS_LIMIT),
    });

    console.log(`⏳ Sending ${AMOUNT_TO_DEPOSIT} ETH to Bridge...`);
    await tx.wait();
    console.log(`✅ Success: https://sepolia.etherscan.io/tx/${tx.hash}`);

  } catch (error) {
    console.error('❌ Error:', error.reason || error.message || error);
  }
}

async function startLoop() {
  await sendETH();

  setInterval(async () => {
    await sendETH();
  }, Number(INTERVAL_MINUTES) * 60 * 1000);
}

startLoop();
