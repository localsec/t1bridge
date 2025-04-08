import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import puppeteer from "puppeteer";

const RPC_URL_SEPOLIA = process.env.RPC_URL_SEPOLIA;
const RPC_URL_T1 = process.env.RPC_URL_T1;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const NETWORK_NAME = "SEPOLIA & T1";
const WEB_URL_DEPOSIT = "https://devnet.t1protocol.com/bridge?transactionType=Deposit";
const WEB_URL_WITHDRAW = "https://devnet.t1protocol.com/bridge?transactionType=Withdraw";
const destChainIdT1 = 299792;
const destChainIdSepolia = 11155111;
const Router_Sepolia = "0xAFdF5cb097D6FB2EB8B1FFbAB180e667458e18F4";
const Router_T1 = "0x627B3692969b7330b8Faed2A8836A41EB4aC1918";
const BridgeABI = [
 "function sendMessage(address _to, uint256 _value, bytes _message, uint256 _gasLimit, uint64 _destChainId, address _callbackAddress) external payable"
];

let walletInfo = {
 address: "",
 balanceEthSepolia: "0.00",
 balanceEthT1: "0.00",
 network: NETWORK_NAME,
 status: "Đang khởi tạo"
};

let transactionLogs = [];
let bridgeRunning = false;
let bridgeCancelled = false;
let globalWallet = null;

function getShortAddress(address) {
 return address.slice(0, 6) + "..." + address.slice(-4);
}

function addLog(message, type) {
 const timestamp = new Date().toLocaleTimeString();
 let coloredMessage = message;
 if (type === "bridge") {
 coloredMessage = `{bright-magenta-fg}${message}{/bright-magenta-fg}`;
 } else if (type === "system") {
 coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
 } else if (type === "error") {
 coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
 } else if (type === "success") {
 coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
 } else if (type === "warning") {
 coloredMessage = `{bright-yellow-fg}${message}{/bright-yellow-fg}`;
 }
 transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
 updateLogs();
}

function getRandomDelay() {
 return Math.random() * (60000 - 30000) + 30000;
}

function getRandomNumber(min, max) {
 return Math.random() * (max - min) + min;
}

function getShortHash(hash) {
 return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function updateLogs() {
 logsBox.setContent(transactionLogs.join("\n"));
 logsBox.setScrollPerc(100);
 safeRender();
}

function clearTransactionLogs() {
 transactionLogs = [];
 updateLogs();
 addLog("Nhật ký giao dịch đã được xóa.", "system");
}

async function waitWithCancel(delay, type) {
 return Promise.race([
 new Promise(resolve => setTimeout(resolve, delay)),
 new Promise(resolve => {
 const interval = setInterval(() => {
 if (type === "bridge" && bridgeCancelled) { clearInterval(interval); resolve(); }
 }, 100);
 })
 ]);
}

const screen = blessed.screen({
 smartCSR: true,
 title: "Cầu T1",
 fullUnicode: true,
 mouse: true
});
let renderTimeout;
function safeRender() {
 if (renderTimeout) clearTimeout(renderTimeout);
 renderTimeout = setTimeout(() => { screen.render(); }, 50);
}

const headerBox = blessed.box({
 top: 0,
 left: "center",
 width: "100%",
 tags: true,
 style: { fg: "white", bg: "default" }
});

figlet.text("LocalSec".toUpperCase(), { font: "Speed", horizontalLayout: "default" }, (err, data) => {
 if (err) headerBox.setContent("{center}{bold}LocalSec{/bold}{/center}");
 else headerBox.setContent(`{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`);
 safeRender();
});

const descriptionBox = blessed.box({
 left: "center",
 width: "100%",
 content: "{center}{bold}{bright-yellow-fg}✦ ✦ CẦU TỰ ĐỘNG T1 ✦ ✦{/bright-yellow-fg}{/bold}{/center}",
 tags: true,
 style: { fg: "white", bg: "default" }
});

const logsBox = blessed.box({
 label: " Nhật Ký Giao Dịch ",
 left: 0,
 border: { type: "line" },
 scrollable: true,
 alwaysScroll: true,
 mouse: true,
 keys: true,
 vi: true,
 tags: true,
 scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
 content: "",
 style: { border: { fg: "bright-cyan" }, bg: "default" }
});

const walletBox = blessed.box({
 label: " Thông Tin Ví ",
 border: { type: "line" },
 tags: true,
 style: { border: { fg: "magenta" }, fg: "white", bg: "default", align: "left", valign: "top" },
 content: "Đang tải dữ liệu ví..."
});

const mainMenu = blessed.list({
 label: " Menu ",
 left: "60%",
 keys: true,
 vi: true,
 mouse: true,
 border: { type: "line" },
 style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "green", fg: "black" } },
 items: getMainMenuItems()
});

const bridgeSubMenu = blessed.list({
 label: " Menu Phụ Cầu T1 ",
 left: "60%",
 keys: true,
 vi: true,
 mouse: true,
 border: { type: "line" },
 style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "cyan", fg: "black" } },
 items: getBridgeMenuItems()
});
bridgeSubMenu.hide();

const promptBox = blessed.prompt({
 parent: screen,
 border: "line",
 height: 5,
 width: "60%",
 top: "center",
 left: "center",
 label: "{bright-blue-fg}Nhập Dữ Liệu Cầu{/bright-blue-fg}",
 tags: true,
 keys: true,
 vi: true,
 mouse: true,
 style: { fg: "bright-red", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(bridgeSubMenu);

function getMainMenuItems() {
 let items = ["Cầu T1", "Xóa Nhật Ký Giao Dịch", "Làm Mới", "Thoát"];
 if (bridgeRunning) {
 items.unshift("Dừng Tất Cả Giao Dịch");
 }
 return items;
}

function getBridgeMenuItems() {
 let items = ["Cầu Tự Động ETH Sepolia & T1", "Xóa Nhật Ký Giao Dịch", "Quay Lại Menu Chính", "Làm Mới"];
 if (bridgeRunning) {
 items.splice(1, 0, "Dừng Giao Dịch");
 }
 return items;
}

function updateWallet() {
 const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "Không có";
 const ethSepolia = walletInfo.balanceEthSepolia ? Number(walletInfo.balanceEthSepolia).toFixed(4) : "0.0000";
 const ethT1 = walletInfo.balanceEthT1 ? Number(walletInfo.balanceEthT1).toFixed(4) : "0.0000";
 const content = `┌── Địa chỉ : {bright-yellow-fg}${shortAddress}{/bright-yellow-fg}
│ ├── ETH Sepolia : {bright-green-fg}${ethSepolia}{/bright-green-fg}
│ └── ETH T1 : {bright-green-fg}${ethT1}{/bright-green-fg}
└── Mạng : {bright-cyan-fg}${NETWORK_NAME}{/bright-cyan-fg}
`;
 walletBox.setContent(content);
 safeRender();
}

async function updateWalletData() {
 try {
 const providerSepolia = new ethers.JsonRpcProvider(RPC_URL_SEPOLIA);
 const providerT1 = new ethers.JsonRpcProvider(RPC_URL_T1);
 const wallet = new ethers.Wallet(PRIVATE_KEY, providerSepolia);
 globalWallet = wallet;
 walletInfo.address = wallet.address;
 const ethBalanceSepolia = await providerSepolia.getBalance(wallet.address);
 walletInfo.balanceEthSepolia = ethers.formatEther(ethBalanceSepolia);
 const ethBalanceT1 = await providerT1.getBalance(wallet.address);
 walletInfo.balanceEthT1 = ethers.formatEther(ethBalanceT1);
 updateWallet();
 addLog("Số dư & Ví đã được cập nhật !!", "system");
 } catch (error) {
 addLog("Không thể lấy dữ liệu ví: " + error.message, "system");
 }
}

function stopAllTransactions() {
 if (bridgeRunning) {
 bridgeCancelled = true;
 addLog("Lệnh Dừng Tất Cả Giao Dịch đã được nhận. Tất cả giao dịch đã dừng.", "system");
 }
}

async function injectTxDataToWeb(txData, transactionType) {
 try {
 const targetURL = transactionType === "Deposit" ? WEB_URL_DEPOSIT : WEB_URL_WITHDRAW;
 const browser = await puppeteer.launch({
 headless: true,
 args: ['--no-sandbox', '--disable-setuid-sandbox'],
 userDataDir: './puppeteer_data'
 });
 const page = await browser.newPage();
 page.on("console", (msg) => {
 console.log("NHẬT KÝ TRANG:", msg.text());
 });

 await page.goto(targetURL, { waitUntil: "networkidle2" });
 await page.waitForSelector("body");

 const injectionResult = await page.evaluate(({ wallet, txData }) => {
 let stateStr = localStorage.getItem("bridgeTransactionsV2");
 let stateObj = stateStr
 ? JSON.parse(stateStr)
 : {
 state: {
 page: 1,
 total: 0,
 frontTransactions: {},
 pageTransactions: []
 },
 version: 0
 };
 const lowerWallet = wallet.toLowerCase();
 if (!stateObj.state.frontTransactions) {
 stateObj.state.frontTransactions = {};
 }
 if (!stateObj.state.frontTransactions[lowerWallet]) {
 stateObj.state.frontTransactions[lowerWallet] = [];
 }
 stateObj.state.frontTransactions[lowerWallet].unshift(txData); 
 localStorage.setItem(" ...

Something went wrong, please try again.
