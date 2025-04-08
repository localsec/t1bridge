const Web3 = require('web3');
const fs = require('fs').promises;

class EthToT1Bridge {
    constructor() {
        this.config = {
            sepoliaRpc: 'https://rpc-sepolia.rockx.com',
            t1Rpc: 'https://rpc.v006.t1protocol.com',
            bridgeContractAddress: '0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4',
            amountToBridge: process.env.AMOUNT_TO_BRIDGE || '0.01',
            destChainId: process.env.DEST_CHAIN_ID || '299792' // Chain ID của T1
        };

        this.bridgeABI = [
            {
                "constant": false,
                "inputs": [
                    {"name": "_to", "type": "address"},
                    {"name": "_value", "type": "uint256"},
                    {"name": "_message", "type": "bytes"},
                    {"name": "_gasLimit", "type": "uint256"},
                    {"name": "_destChainId", "type": "uint64"},
                    {"name": "_callbackAddress", "type": "address"}
                ],
                "name": "sendMessage",
                "outputs": [],
                "payable": true,
                "stateMutability": "payable",
                "type": "function"
            }
        ];

        this.web3 = new Web3(this.config.sepoliaRpc);
    }

    async loadPrivateKey() {
        try {
            const data = await fs.readFile('wallets.txt', 'utf8');
            const privateKey = data.trim();
            if (!privateKey) throw new Error('Không tìm thấy private key trong wallets.txt');
            this.account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            this.web3.eth.accounts.wallet.add(this.account);
            this.bridgeContract = new this.web3.eth.Contract(
                this.bridgeABI,
                this.config.bridgeContractAddress
            );
            console.log('Đã load private key từ wallets.txt');
            console.log('Địa chỉ ví:', this.account.address);
        } catch (error) {
            throw new Error(`Lỗi khi đọc file wallets.txt: ${error.message}`);
        }
    }

    async checkBalance() {
        const balance = await this.web3.eth.getBalance(this.account.address);
        const balanceEth = this.web3.utils.fromWei(balance, 'ether');
        console.log('Số dư hiện tại:', balanceEth, 'ETH');
        return balanceEth;
    }

    async bridgeEth(toAddress, message = "0x", gasLimit = "200000", destChainId = this.config.destChainId, callbackAddress = "0x0000000000000000000000000000000000000000") {
        try {
            if (!this.web3.utils.isAddress(toAddress)) {
                throw new Error(`Địa chỉ đích không hợp lệ: ${toAddress}`);
            }

            const amountInWei = this.web3.utils.toWei(this.config.amountToBridge, 'ether');
            
            const balance = await this.checkBalance();
            if (parseFloat(balance) < parseFloat(this.config.amountToBridge)) {
                throw new Error('Số dư không đủ để bridge');
            }

            console.log('Tham số giao dịch:');
            console.log('Bridge Contract:', this.config.bridgeContractAddress);
            console.log('To Address:', toAddress);
            console.log('Value:', this.config.amountToBridge, 'ETH (', amountInWei, 'wei)');
            console.log('Message:', message);
            console.log('Gas Limit:', gasLimit);
            console.log('Dest Chain ID:', destChainId);
            console.log('Callback Address:', callbackAddress);

            const tx = {
                from: this.account.address,
                to: this.config.bridgeContractAddress,
                value: amountInWei,
                gas: 300000, // Tăng gas limit để tránh out of gas
                data: this.bridgeContract.methods.sendMessage(
                    toAddress,
                    amountInWei,
                    message,
                    gasLimit,
                    destChainId,
                    callbackAddress
                ).encodeABI()
            };

            console.log('Đang gửi giao dịch bridge...');
            const signedTx = await this.web3.eth.accounts.signTransaction(tx, this.account.privateKey);
            const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction)
                .on('transactionHash', hash => console.log('Tx Hash:', hash))
                .on('error', error => console.error('Lỗi trong quá trình gửi:', error));

            console.log('Giao dịch hoàn tất!');
            console.log('Transaction hash:', receipt.transactionHash);
            console.log('Đã bridge', this.config.amountToBridge, 'ETH sang T1');
            return receipt;

        } catch (error) {
            console.error('Lỗi khi bridge:', error);
            throw error;
        }
    }

    async executeWithRetry(toAddress, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`Thử lần ${attempt}/${maxAttempts}`);
                const result = await this.bridgeEth(toAddress);
                return result;
            } catch (error) {
                if (attempt === maxAttempts) {
                    console.error('Đã hết số lần thử');
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }
}

async function main() {
    try {
        const bridge = new EthToT1Bridge();
        await bridge.loadPrivateKey();
        const destinationAddress = "0x627B3692969b7330b8Faed2A8836A41EB4aC1918"; // Contract trên T1
        await bridge.executeWithRetry(destinationAddress);
        process.exit(0);
    } catch (error) {
        console.error('Lỗi:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = EthToT1Bridge;
