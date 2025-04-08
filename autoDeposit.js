const { ethers } = require("ethers");
require("dotenv").config();

// Cấu hình từ biến môi trường
const config = {
    SEPOLIA_RPC: process.env.SEPOLIA_RPC || "https://rpc.sepolia.org",
    T1_NETWORK: process.env.T1_NETWORK || "https://devnet-rpc.t1protocol.com",
    BRIDGE_ADDRESS: process.env.BRIDGE_ADDRESS || "0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4",
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    AMOUNT_TO_DEPOSIT: process.env.AMOUNT_TO_DEPOSIT || "0.1", // ETH
    GAS_LIMIT: process.env.GAS_LIMIT || "300000",
    INTERVAL_MINUTES: process.env.INTERVAL_MINUTES || "30"
};

// ABI của bridge contract (cần cập nhật từ T1 documentation)
const BRIDGE_ABI = [
    "function depositETH(uint256 amount) external payable",
    "event Deposit(address indexed sender, uint256 amount)"
];

/**
 * Thực hiện deposit ETH từ Sepolia sang T1 qua bridge contract
 */
async function autoDeposit() {
    try {
        // Kiểm tra private key
        if (!config.PRIVATE_KEY) {
            throw new Error("PRIVATE_KEY is not set in .env");
        }

        // Kết nối với Sepolia network
        const provider = new ethers.providers.JsonRpcProvider(config.SEPOLIA_RPC);
        const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);

        // Kết nối với bridge contract
        const bridgeContract = new ethers.Contract(
            config.BRIDGE_ADDRESS,
            BRIDGE_ABI,
            wallet
        );

        // Số lượng ETH để deposit
        const amountToDeposit = ethers.utils.parseEther(config.AMOUNT_TO_DEPOSIT);

        // Kiểm tra balance
        const balance = await wallet.getBalance();
        console.log(`Current balance: ${ethers.utils.formatEther(balance)} ETH`);

        if (balance.lt(amountToDeposit)) {
            throw new Error("Insufficient balance");
        }

        // Thực hiện deposit
        console.log("Initiating deposit...");
        const tx = await bridgeContract.depositETH(amountToDeposit, {
            value: amountToDeposit,
            gasLimit: config.GAS_LIMIT
        });

        // Chờ xác nhận
        console.log("Waiting for transaction confirmation...");
        const receipt = await tx.wait();
        
        console.log("Deposit successful!");
        console.log(`Transaction hash: ${receipt.transactionHash}`);
        
        // Kiểm tra balance mới
        const newBalance = await wallet.getBalance();
        console.log(`New balance: ${ethers.utils.formatEther(newBalance)} ETH`);

    } catch (error) {
        console.error("Error during deposit:", error.message);
    }
}

/**
 * Khởi động dịch vụ deposit tự động
 */
function startAutoDeposit() {
    console.log("Starting auto deposit service...");
    autoDeposit(); // Chạy lần đầu
    
    const intervalMs = parseInt(config.INTERVAL_MINUTES) * 60 * 1000;
    setInterval(autoDeposit, intervalMs);
}

// Chạy chương trình
if (require.main === module) {
    startAutoDeposit();
}

module.exports = { autoDeposit, startAutoDeposit };
