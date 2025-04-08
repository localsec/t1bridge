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

// Danh sách RPC endpoints (fallback)
const SEPOLIA_RPCS = [
    process.env.SEPOLIA_RPC || "https://ethereum-sepolia.rpc.subquery.network", // Cập nhật RPC Sepolia
    "https://1rpc.io/sepolia",
    "https://rpc-sepolia.rockx.com"
];

// Cấu hình từ biến môi trường
const config = {
    SEPOLIA_RPCS,
    T1_NETWORK: process.env.T1_NETWORK || "https://rpc.v006.t1protocol.com/",
    BRIDGE_ADDRESS: process.env.BRIDGE_ADDRESS || "0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4",
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    AMOUNT_TO_DEPOSIT: process.env.AMOUNT_TO_DEPOSIT || "0.1", // ETH
    GAS_LIMIT: process.env.GAS_LIMIT || "300000",
    L2_GAS_LIMIT: process.env.L2_GAS_LIMIT || "500000",
    L2_RECIPIENT: process.env.L2_RECIPIENT || "0x4860CA818c3650Bc928dF43ea4eDA07704FC1581",
    INTERVAL_MINUTES: process.env.INTERVAL_MINUTES || "30"
};

// ABI của proxy contract
const PROXY_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "_logic", "type": "address"},
            {"internalType": "address", "name": "admin_", "type": "address"},
            {"internalType": "bytes", "name": "_data", "type": "bytes"}
        ],
        "stateMutability": "payable",
        "type": "constructor"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": false, "internalType": "address", "name": "previousAdmin", "type": "address"},
            {"indexed": false, "internalType": "address", "name": "newAdmin", "type": "address"}
        ],
        "name": "AdminChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "beacon", "type": "address"}
        ],
        "name": "BeaconUpgraded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "implementation", "type": "address"}
        ],
        "name": "Upgraded",
        "type": "event"
    },
    {"stateMutability": "payable", "type": "fallback"},
    {"stateMutability": "payable", "type": "receive"}
];

// ABI của implementation contract (Optimism L1StandardBridge)
const IMPLEMENTATION_ABI = [
    {
        "constant": false,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_l2Gas", "type": "uint32"},
            {"name": "_data", "type": "bytes"}
        ],
        "name": "depositETHTo",
        "outputs": [],
        "payable": true,
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "address", "name": "_from", "type": "address"},
            {"indexed": true, "internalType": "address", "name": "_to", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "_amount", "type": "uint256"},
            {"indexed": false, "internalType": "bytes", "name": "_data", "type": "bytes"}
        ],
        "name": "ETHDepositInitiated",
        "type": "event"
    }
];

// Storage slot cho implementation (EIP-1967)
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/**
 * Thử kết nối với một RPC endpoint khả dụng
 */
async function getWorkingProvider(rpcs) {
    for (const rpc of rpcs) {
        logger.info(`Attempting to connect to RPC: ${rpc}`);
        try {
            const provider = new ethers.providers.JsonRpcProvider(rpc);
            const network = await provider.getNetwork();
            logger.info(`Connected to ${rpc} - Network: ${network.name} (chainId: ${network.chainId})`);
            return provider;
        } catch (error) {
            logger.warn(`Failed to connect to ${rpc}: ${error.message}`);
        }
    }
    throw new Error("No working RPC endpoints available");
}

/**
 * Lấy địa chỉ implementation từ proxy (EIP-1967)
 */
async function getImplementationAddress(provider, proxyAddress) {
    try {
        const implHex = await provider.getStorageAt(proxyAddress, IMPLEMENTATION_SLOT);
        const implAddress = ethers.utils.getAddress(ethers.utils.hexDataSlice(implHex, 12));
        logger.info(`Implementation address: ${implAddress}`);
        return implAddress;
    } catch (error) {
        logger.error(`Failed to get implementation address: ${error.message}`);
        throw error;
    }
}

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
        if (!ethers.utils.isAddress(config.L2_RECIPIENT)) {
            throw new Error(`Invalid L2_RECIPIENT: ${config.L2_RECIPIENT}`);
        }

        // Kết nối với Sepolia network
        const provider = await getWorkingProvider(config.SEPOLIA_RPCS);

        // Khởi tạo wallet
        logger.info("Initializing wallet...");
        const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
        const walletAddress = await wallet.getAddress();
        logger.info(`Using wallet address: ${walletAddress}`);

        // Kiểm tra proxy contract
        const proxyCode = await provider.getCode(config.BRIDGE_ADDRESS);
        if (proxyCode === "0x") {
            throw new Error(`No contract deployed at ${config.BRIDGE_ADDRESS}`);
        }
        logger.info("Proxy contract exists");

        // Lấy địa chỉ implementation
        const implAddress = await getImplementationAddress(provider, config.BRIDGE_ADDRESS);
        const implCode = await provider.getCode(implAddress);
        if (implCode === "0x") {
            throw new Error(`No implementation contract deployed at ${implAddress}`);
        }
        logger.info("Implementation contract exists and is callable");

        // Kết nối với bridge contract qua proxy
        logger.info(`Connecting to bridge contract at ${config.BRIDGE_ADDRESS} (implementation: ${implAddress})`);
        const bridgeContract = new ethers.Contract(
            config.BRIDGE_ADDRESS, // Gọi qua proxy
            IMPLEMENTATION_ABI,
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
        logger.info(`Initiating deposit to bridge ${config.BRIDGE_ADDRESS} for L2 recipient ${config.L2_RECIPIENT}`);
        const tx = await bridgeContract.depositETHTo(
            config.L2_RECIPIENT,
            config.L2_GAS_LIMIT,
            "0x", // _data rỗng
            {
                value: amountToDeposit,
                gasLimit: config.GAS_LIMIT
            }
        );

        logger.info(`Transaction submitted. Hash: ${tx.hash}`);

        // Chờ xác nhận
        logger.info("Waiting for transaction confirmation...");
        const receipt = await tx.wait();

        const txDetails = {
            hash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            gasUsed: ethers.utils.formatUnits(receipt.gasUsed, "wei"),
            status: receipt.status === 1 ? "Success" : "Failed",
            implementation: implAddress
        };

        if (receipt.status === 1) {
            logger.info("Deposit successful!");
            logger.info(`Transaction details: ${JSON.stringify(txDetails, null, 2)}`);
        } else {
            logger.error("Deposit failed!");
            logger.error(`Transaction details: ${JSON.stringify(txDetails, null, 2)}`);
            try {
                const txError = await provider.call({
                    to: config.BRIDGE_ADDRESS,
                    data: tx.data,
                    value: tx.value,
                    gasLimit: tx.gasLimit
                }, receipt.blockNumber - 1); // Gọi tại block trước đó
                logger.error(`Revert reason: ${txError}`);
            } catch (callError) {
                logger.error(`Failed to get revert reason: ${callError.message}`);
                if (callError.data) {
                    logger.error(`Revert data: ${callError.data}`);
                }
            }
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
        if (error.data) {
            logger.error(`Error data: ${error.data}`);
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
