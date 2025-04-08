const { ethers } = require("ethers");
const winston = require("winston");
require("dotenv").config();

// Cấu hình logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "deposit.log" })
    ]
});

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
    logger.info("Starting deposit process...");
    
    try {
        // Kiểm tra cấu hình
        if (!config.PRIVATE_KEY) {
            throw new Error("PRIVATE_KEY is not set in .env file");
        }
        if (!ethers.utils.isAddress(config.BRIDGE_ADDRESS)) {
            throw new Error(`Invalid BRIDGE_ADDRESS: ${config.BRIDGE_ADDRESS}`);
        }

        // Kết nối với Sepolia network
        logger.info(`Connecting to Sepolia RPC: ${config.SEPOLIA_RPC}`);
        const provider = new ethers.providers.JsonRpcProvider(config.SEPOLIA_RPC);
        
        // Kiểm tra kết nối mạng
        const network = await provider.getNetwork();
        logger.info(`Connected to network: ${network.name} (chainId: ${network.chainId})`);

        // Khởi tạo wallet
        const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        logger.info(`Using wallet address: ${walletAddress}`);

        // Kết nối với bridge contract
        const bridgeContract = new ethers.Contract(
            config.BRIDGE_ADDRESS,
            BRIDGE_ABI,
            wallet
        );

        // Số lượng ETH để deposit
        const amountToDeposit = ethers.utils.parseEther(config.AMOUNT_TO_DEPOSIT);
        logger.info(`Amount to deposit: ${config.AMOUNT_TO_DEPOSIT} ETH`);

        // Kiểm tra balance
        const balance = await wallet.getBalance();
        logger.info(`Current balance: ${ethers.utils.formatEther(balance)} ETH`);

        if (balance.lt(amountToDeposit)) {
            throw new Error(`Insufficient balance. Required: ${config.AMOUNT_TO_DEPOSIT} ETH`);
        }

        // Thực hiện deposit
        logger.info(`Initiating deposit to bridge ${config.BRIDGE_ADDRESS}`);
        const tx = await bridgeContract.depositETH(amountToDeposit, {
            value: amountToDeposit,
            gasLimit: config.GAS_LIMIT
        });

        logger.info(`Transaction submitted. Hash: ${tx.hash}`);

        // Chờ xác nhận
        logger.info("Waiting for transaction confirmation...");
        const receipt = await tx.wait();

        const txDetails = {
            hash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            gasUsed: ethers.utils.formatUnits(receipt.gasUsed, "wei"),
            status: receipt.status === 1 ? "Success" : "Failed"
        };

        if (receipt.status === 1) {
            logger.info("Deposit successful!");
            logger.info(`Transaction details: ${JSON.stringify(txDetails, null, 2)}`);
        } else {
            logger.error("Deposit failed!");
            logger.error(`Transaction details: ${JSON.stringify(txDetails, null, 2)}`);
        }

        // Kiểm tra balance mới
        const newBalance = await wallet.getBalance();
        logger.info(`New balance: ${ethers.utils.formatEther(newBalance)} ETH`);

    } catch (error) {
        logger.error(`Deposit process failed: ${error.message}`);
        if (error.transaction) {
            logger.error(`Failed transaction hash: ${error.transaction.hash}`);
        }
        if (error.reason) {
            logger.error(`Reason: ${error.reason}`);
        }
    }
}

/**
 * Khởi động dịch vụ deposit tự động
 */
function startAutoDeposit() {
    logger.info("Starting auto deposit service...");
    autoDeposit(); // Chạy lần đầu
    
    const intervalMs = parseInt(config.INTERVAL_MINUTES) * 60 * 1000;
    setInterval(autoDeposit, intervalMs);
    logger.info(`Scheduled deposits every ${config.INTERVAL_MINUTES} minutes`);
}

// Chạy chương trình
if (require.main === module) {
    startAutoDeposit();
}

module.exports = { autoDeposit, startAutoDeposit };
