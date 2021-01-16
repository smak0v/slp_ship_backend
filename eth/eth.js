const Web3 = require("web3");
const fetch = require("node-fetch");

const web3 = new Web3(
  `wss://kovan.infura.io/ws/v3/${process.env.INFURA_PROJECT_ID}`
);

const factoryAbi = require("../contracts/Factory.json").abi;
const multiSigWalletAbi = require("../contracts/MultiSigWallet.json").abi;

const factoryInstance = new web3.eth.Contract(
  factoryAbi,
  process.env.WSLP_FACTORY
);
const multiSigWalletInstance = new web3.eth.Contract(
  multiSigWalletAbi,
  process.env.MULTI_SIG_WALLET
);

async function getWslpAddressForSlpAddress(utxoInfo) {
  try {
    return factoryInstance.methods
      .getErc20(utxoInfo.tokenId)
      .call({ from: process.env.ETH_ADMIN_ADDRESS })
      .then(async function (result) {
        if (result === "0x0000000000000000000000000000000000000000") {
          await createWslpToken(
            utxoInfo.tokenId,
            utxoInfo.tokenTicker,
            utxoInfo.tokenName,
            utxoInfo.decimals
          );
          return await getWslpAddressForSlpAddress(utxoInfo);
        } else {
          return result;
        }
      });
  } catch (err) {
    console.error(err);
  }
}

async function createWslpToken(slpTokenAddress, symbol, name, decimals) {
  try {
    const gasPrice = await (
      await fetch("https://www.etherchain.org/api/gasPriceOracle")
    ).json();
    const tx = {
      from: process.env.ETH_ADMIN_ADDRESS,
      to: process.env.WSLP_FACTORY,
      gas: process.env.GAS_LIMIT,
      value: 0,
      gasPrice: web3.utils.toWei(gasPrice.fast.toString(), "gwei"),
      nonce: await web3.eth.getTransactionCount(
        process.env.ETH_ADMIN_ADDRESS,
        "pending"
      ),
      data: factoryInstance.methods
        .createWslp(slpTokenAddress, symbol, name, decimals)
        .encodeABI(),
    };
    const signedTx = await web3.eth.accounts.signTransaction(
      tx,
      process.env.ETH_ADMIN_PRIVATE_KEY
    );

    await web3.eth.sendSignedTransaction(
      signedTx.raw || signedTx.rawTransaction
    );
  } catch (err) {
    console.error(err);
  }
}

module.exports = {
  getWslpAddressForSlpAddress,
};
