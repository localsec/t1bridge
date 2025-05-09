import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";
import puppeteer from "puppeteer";

const RPC_URL_SEPOLIA = process.env.RPC_URL_SEPOLIA;
const RPC_URL_T1 = process.env.RPC_URL_T1;
// Chuyển PRIVATE_KEY thành mảng các khóa riêng từ biến môi trường
const PRIVATE_KEYS = process.env.PRIVATE_KEYS ? process.env.PRIVATE_KEYS.split(",") : [];
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

// Cập nhật walletInfo thành mảng để lưu thông tin nhiều ví
let walletInfo = [];
let transactionLogs = [];
let bridgeRunning = false;
let bridgeCancelled = false;
let globalWallets = [];

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
  content: "{center}{bold}{bright-yellow-fg}✦ ✦ CẦU TỰ ĐỘNG ĐI THÁI BÌNH T1 ✦ ✦{/bright-yellow-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white", bg: "default" }
});

const logsBox = blessed.box({
  label: " Nhật ký giao dịch ",
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
  label: " Thông tin ví ",
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
  label: " Menu phụ cầu T1 ",
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
  label: "{bright-blue-fg}Nhập liệu cầu{/bright-blue-fg}",
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
  let items = ["Cầu T1", "Xóa nhật ký giao dịch", "Làm mới", "Thoát"];
  if (bridgeRunning) {
    items.unshift("Dừng tất cả giao dịch");
  }
  return items;
}

function getBridgeMenuItems() {
  let items = ["Cầu tự động ETH Sepolia => T1 Thái Bình", "Xóa nhật ký giao dịch", "Quay lại menu chính", "Làm mới"];
  if (bridgeRunning) {
    items.splice(1, 0, "Dừng giao dịch");
  }
  return items;
}

function updateWallet() {
  let content = "";
  walletInfo.forEach((info, index) => {
    const shortAddress = info.address ? getShortAddress(info.address) : "N/A";
    const ethSepolia = info.balanceEthSepolia ? Number(info.balanceEthSepolia).toFixed(4) : "0.0000";
    const ethT1 = info.balanceEthT1 ? Number(info.balanceEthT1).toFixed(4) : "0.0000";
    content += `┌── Ví ${index + 1} - Địa chỉ: {bright-yellow-fg}${shortAddress}{/bright-yellow-fg}
│   ├── ETH Sepolia  : {bright-green-fg}${ethSepolia}{/bright-green-fg}
│   └── ETH T1       : {bright-green-fg}${ethT1}{/bright-green-fg}
└── Mạng             : {bright-cyan-fg}${NETWORK_NAME}{/bright-cyan-fg}
`;
  });
  walletBox.setContent(content || "Không có ví nào được tải.");
  safeRender();
}

async function updateWalletData() {
  try {
    const providerSepolia = new ethers.JsonRpcProvider(RPC_URL_SEPOLIA);
    const providerT1 = new ethers.JsonRpcProvider(RPC_URL_T1);
    walletInfo = [];
    globalWallets = [];
    
    for (const privateKey of PRIVATE_KEYS) {
      const wallet = new ethers.Wallet(privateKey.trim(), providerSepolia);
      globalWallets.push(wallet);
      const ethBalanceSepolia = await providerSepolia.getBalance(wallet.address);
      const ethBalanceT1 = await providerT1.getBalance(wallet.address);
      walletInfo.push({
        address: wallet.address,
        balanceEthSepolia: ethers.formatEther(ethBalanceSepolia),
        balanceEthT1: ethers.formatEther(ethBalanceT1),
        network: NETWORK_NAME
      });
    }
    updateWallet();
    addLog("Số dư & Ví đã được cập nhật !!", "system");
  } catch (error) {
    addLog("Không thể lấy dữ liệu ví: " + error.message, "system");
  }
}

function stopAllTransactions() {
  if (bridgeRunning) {
    bridgeCancelled = true;
    addLog("Lệnh dừng tất cả giao dịch đã được nhận. Tất cả giao dịch đã bị dừng.", "system");
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
        localStorage.setItem("bridgeTransactionsV2", JSON.stringify(stateObj));
        return stateObj;
    }, { wallet: txData.from, txData });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await browser.close();
    addLog("T1: Thành công chèn giao dịch vào web.", "success");
  } catch (error) {
    addLog("Lỗi chèn: " + error.message, "error");
  }
}

async function bridgeFromSepoliaToT1(i, amount, walletIndex) {
  const privateKey = PRIVATE_KEYS[walletIndex].trim();
  addLog(`T1: Thực hiện cầu Sepolia ➯ T1 (Ví ${walletIndex + 1}), Số lượng ${ethers.formatEther(amount)} ETH `, "bridge");
  const providerSepolia = new ethers.JsonRpcProvider(RPC_URL_SEPOLIA);
  const walletSepolia = new ethers.Wallet(privateKey, providerSepolia);
  const contractSepolia = new ethers.Contract(Router_Sepolia, BridgeABI, walletSepolia);
  const extraFee = ethers.parseEther("0.000000000000168");
  const totalValue = amount + extraFee;
  try {
    const tx = await contractSepolia.sendMessage(
      walletSepolia.address,
      amount,
      "0x",            
      168000,       
      destChainIdT1,
      walletSepolia.address,
      { value: totalValue, gasLimit: 500000 }
    );
    addLog(`T1: Giao dịch đã gửi (Ví ${walletIndex + 1}). Hash: ${getShortHash(tx.hash)}`, "bridge");
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      addLog(`T1: Giao dịch thành công (Ví ${walletIndex + 1}). Hash: ${getShortHash(tx.hash)} .`, "success");
      const blockNumber = receipt.blockNumber;
      const txData = {
        hash: tx.hash,
        amount: amount.toString(),
        isL1: true,
        timestamp: Date.now(),
        initiatedAt: Math.floor(Date.now() / 1000),
        txStatus: 0,
        fromBlockNumber: blockNumber,
        from: walletSepolia.address
      };
      await injectTxDataToWeb(txData, "Deposit");
      await updateWalletData();
    } else {
      addLog(`T1: Giao dịch thất bại (Ví ${walletIndex + 1}).`, "error");
    }
  } catch (error) {
    addLog(`T1: Lỗi (Ví ${walletIndex + 1}) - ${error.message}`, "error");
  }
}

async function bridgeFromT1ToSepolia(i, amount, walletIndex) {
  const privateKey = PRIVATE_KEYS[walletIndex].trim();
  addLog(`T1: Thực hiện cầu T1 ➯ Sepolia (Ví ${walletIndex + 1}), Số lượng ${ethers.formatEther(amount)} ETH `, "bridge");
  const providerT1 = new ethers.JsonRpcProvider(RPC_URL_T1);
  const walletT1 = new ethers.Wallet(privateKey, providerT1);
  const contractT1 = new ethers.Contract(Router_T1, BridgeABI, walletT1);
  try {
    const tx = await contractT1.sendMessage(
      walletT1.address,
      amount,
      "0x",
      0,
      destChainIdSepolia,
      walletT1.address,
      { value: amount, gasLimit: 500000 }
    );
    addLog(`T1: Giao dịch đã gửi (Ví ${walletIndex + 1}). Hash: ${getShortHash(tx.hash)}`, "bridge");
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      addLog(`T1: Giao dịch thành công (Ví ${walletIndex + 1}). Hash: ${getShortHash(tx.hash)}`, "success");
      const txData = {
        hash: tx.hash,
        amount: amount.toString(),
        isL1: false,
        timestamp: Date.now(),
        initiatedAt: Math.floor(Date.now() / 1000),
        txStatus: 0,
        fromBlockNumber: receipt.blockNumber,
        from: walletT1.address
      };
      await injectTxDataToWeb(txData, "Withdraw");
      await updateWalletData();
    } else {
      addLog(`T1: Giao dịch thất bại (Ví ${walletIndex + 1}).`, "error");
    }
  } catch (error) {
    addLog(`T1: Lỗi (Ví ${walletIndex + 1}) - ${error.message}`, "error");
  }
}

async function runAutoBridge() {
  promptBox.setFront();
  promptBox.readInput("Nhập số lần thực hiện cầu:", "", async (err, value) => {
    promptBox.hide();
    safeRender();
    if (err || !value) {
      addLog("Cầu T1: Đầu vào không hợp lệ hoặc bị hủy.", "bridge");
      return;
    }
    const loopCount = parseInt(value);
    if (isNaN(loopCount)) {
      addLog("Cầu T1: Đầu vào phải là số.", "bridge");
      return;
    }
    addLog(`Cầu T1: Bạn đã nhập ${loopCount} lần cầu tự động cho ${PRIVATE_KEYS.length} ví.`, "bridge");
    if (bridgeRunning) {
      addLog("Cầu T1: Giao dịch đang chạy. Vui lòng dừng giao dịch trước.", "system");
      return;
    }
    bridgeRunning = true;
    bridgeCancelled = false;
    mainMenu.setItems(getMainMenuItems());
    bridgeSubMenu.setItems(getBridgeMenuItems());
    bridgeSubMenu.show();
    safeRender();

    for (let i = 1; i <= loopCount; i++) {
      if (bridgeCancelled) {
        addLog(`Cầu T1: Cầu tự động bị dừng tại chu kỳ ${i}.`, "bridge");
        break;
      }
      const randomAmount = getRandomNumber(0.0001, 0.001);
      const amount = ethers.parseEther(randomAmount.toFixed(6));

      // Lặp qua tất cả các ví
      for (let walletIndex = 0; walletIndex < PRIVATE_KEYS.length; walletIndex++) {
        if (bridgeCancelled) {
          addLog(`Cầu T1: Cầu tự động bị dừng tại ví ${walletIndex + 1}.`, "bridge");
          break;
        }
        if (i % 2 === 1) {
          await bridgeFromSepoliaToT1(i, amount, walletIndex);
        } else {
          await bridgeFromT1ToSepolia(i, amount, walletIndex);
        }
      }

      if (i < loopCount) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        addLog(`Cầu T1: Cầu thứ ${i} hoàn tất cho tất cả ví.`, "bridge");
        addLog(`Cầu T1: Đợi ${minutes} phút ${seconds} giây trước giao dịch tiếp theo...`, "bridge");
        await waitWithCancel(delayTime, "bridge");
        if (bridgeCancelled) {
          addLog("Cầu T1: Cầu tự động bị dừng trong thời gian chờ.", "bridge");
          break;
        }
      }
    }
    bridgeRunning = false;
    mainMenu.setItems(getMainMenuItems());
    bridgeSubMenu.setItems(getBridgeMenuItems());
    safeRender();
    addLog("Cầu T1: Cầu tự động hoàn tất.", "bridge");
  });
}

function adjustLayout() {
  const screenHeight = screen.height;
  const screenWidth = screen.width;
  const headerHeight = Math.max(8, Math.floor(screenHeight * 0.15));
  headerBox.top = 0;
  headerBox.height = headerHeight;
  headerBox.width = "100%";
  descriptionBox.top = "25%";
  descriptionBox.height = Math.floor(screenHeight * 0.05);
  logsBox.top = headerHeight + descriptionBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(screenWidth * 0.6);
  logsBox.height = screenHeight - (headerHeight + descriptionBox.height);
  walletBox.top = headerHeight + descriptionBox.height;
  walletBox.left = Math.floor(screenWidth * 0.6);
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  mainMenu.top = headerHeight + descriptionBox.height + walletBox.height;
  mainMenu.left = Math.floor(screenWidth * 0.6);
  mainMenu.width = Math.floor(screenWidth * 0.4);
  mainMenu.height = screenHeight - (headerHeight + descriptionBox.height + walletBox.height);
  bridgeSubMenu.top = mainMenu.top;
  bridgeSubMenu.left = mainMenu.left;
  bridgeSubMenu.width = mainMenu.width;
  bridgeSubMenu.height = mainMenu.height;
  safeRender();
}

screen.on("resize", adjustLayout);
adjustLayout();

mainMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Dừng tất cả giao dịch") {
    stopAllTransactions();
    mainMenu.setItems(getMainMenuItems());
    mainMenu.focus();
    safeRender();
  } else if (selected === "Cầu T1") {
    bridgeSubMenu.show();
    bridgeSubMenu.focus();
    safeRender();
  } else if (selected === "Xóa nhật ký giao dịch") {
    clearTransactionLogs();
  } else if (selected === "Làm mới") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Đã làm mới", "system");
  } else if (selected === "Thoát") {
    process.exit(0);
  }
});

bridgeSubMenu.on("select", (item) => {
  const selected = item.getText();
  if (selected === "Cầu tự động ETH Sepolia & T1") {
    runAutoBridge();
  } else if (selected === "Dừng giao dịch") {
    if (bridgeRunning) {
      bridgeCancelled = true;
      addLog("Cầu T1: Lệnh dừng giao dịch đã được nhận.", "bridge");
    } else {
      addLog("Cầu T1: Không có giao dịch nào đang chạy.", "bridge");
    }
  } else if (selected === "Xóa nhật ký giao dịch") {
    clearTransactionLogs();
  } else if (selected === "Quay lại menu chính") {
    bridgeSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Làm mới") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Đã làm mới", "system");
  }
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => { logsBox.scroll(-1); safeRender(); });
screen.key(["C-down"], () => { logsBox.scroll(1); safeRender(); });

safeRender();
mainMenu.focus();
addLog("Từ giờ hãy gọi Vân là EM GÁI MƯA!!", "system");
updateLogs();
updateWalletData();
