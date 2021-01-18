const Web3 = require("web3");
const abiDecoder = require("abi-decoder");

const { prepareETHAddress } = require("../utils/prepareEthAddress");
const { executeQuery, connection } = require("../database/db");
const bch = require("../bch/bch");

const factoryAbi = require("../contracts/Factory.json").abi;
const multiSigWalletAbi = require("../contracts/MultiSigWallet.json").abi;
const wslpAbi = require("../contracts/WrappedSLP.json").abi;

const web3 = new Web3(
  `wss://kovan.infura.io/ws/v3/${process.env.INFURA_PROJECT_ID}`
);

const factoryInstance = new web3.eth.Contract(
  factoryAbi,
  process.env.WSLP_FACTORY
);
const multiSigWalletInstance = new web3.eth.Contract(
  multiSigWalletAbi,
  process.env.MULTI_SIG_WALLET
);

abiDecoder.addABI(wslpAbi);
checkFactoryForExistingWslp();

multiSigWalletInstance.events.Confirmation({}, async function (error, event) {
  if (event.returnValues.sender == process.env.ETH_SIGNER1) {
    console.log(
      `Transaction with id=${event.returnValues.transactionId} was confirmed by ${process.env.ETH_SIGNER1}`
    );

    await confirmMultisigTransaction(
      process.env.ETH_SIGNER2,
      process.env.ETH_SIGNER2_PRIVATE_KEY,
      event.returnValues.transactionId
    );
  } else if (event.returnValues.sender == process.env.ETH_SIGNER2) {
    await confirmMultisigTransaction(
      process.env.ETH_SIGNER3,
      process.env.ETH_SIGNER3_PRIVATE_KEY,
      event.returnValues.transactionId
    );

    multiSigWalletInstance.methods
      .transactions(event.returnValues.transactionId)
      .call({ from: process.env.ETH_ADMIN })
      .then(async function (result) {
        const decodedData = abiDecoder.decodeMethod(result.data);

        await executeQuery(
          connection,
          `UPDATE slpToWslpRequests SET processed=1 WHERE slpTxId='${decodedData.params[2].value}'`,
          function () {}
        );
      });
  }
});

factoryInstance.events.WslpCreated({}, async function (error, event) {
  await executeQuery(
    connection,
    `INSERT INMTo slpToWslp (slp, wslp) VALUES ('${event.returnValues._slp}', '${event.returnValues._erc20}')`,
    function () {}
  );
  console.log("WSLP created: ", event.returnValues._erc20);
  subscribeOnWslpUnlockRequest(event.returnValues._erc20);
});

async function checkFactoryForExistingWslp() {
  const wslpCount = await factoryInstance.methods
    .allPairsLength()
    .call({ from: process.env.ETH_ADMIN });

  for (let i = 0; i < wslpCount; i++) {
    const slpAddress = await factoryInstance.methods
      .allSlp(i)
      .call({ from: process.env.ETH_ADMIN });
    const wslpAddress = await factoryInstance.methods
      .getErc20(slpAddress)
      .call({ from: process.env.ETH_ADMIN });

    subscribeOnWslpUnlockRequest(wslpAddress);
  }
}

async function getGasPrice() {
  try {
    return web3.utils.toWei("2", "gwei");
  } catch (err) {
    console.error("Error in getGasPrice: ", err);

    return 0;
  }
}

async function getNonce(address) {
  try {
    return await web3.eth.getTransactionCount(address, "pending");
  } catch (err) {
    console.error("Error in getNonce: ", err);

    return 0;
  }
}

async function getWslpAddressForSlpAddress(utxoInfo) {
  try {
    return factoryInstance.methods
      .getErc20(utxoInfo.tokenId)
      .call({ from: process.env.ETH_ADMIN })
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
    console.error("Error in getWslpAddressForSlpAddress: ", err);
  }
}

async function createWslpToken(slpTokenAddress, symbol, name, decimals) {
  try {
    const tx = {
      from: process.env.ETH_ADMIN,
      to: process.env.WSLP_FACTORY,
      gas: process.env.GAS_LIMIT,
      value: 0,
      gasPrice: await getGasPrice(),
      nonce: await getNonce(process.env.ETH_ADMIN),
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
    console.error("Error in createWslpToken: ", err);
  }
}

async function submitMultiSigTransaction(
  wslpAddress,
  receiver,
  amount,
  slpTrx
) {
  try {
    const wslpTokenInstance = new web3.eth.Contract(wslpAbi, wslpAddress);
    const callAbi = await wslpTokenInstance.methods
      .deposit(prepareETHAddress(receiver), amount, slpTrx)
      .encodeABI();
    const tx = {
      from: process.env.ETH_SIGNER1,
      to: process.env.MULTI_SIG_WALLET,
      gas: process.env.GAS_LIMIT,
      value: 0,
      gasPrice: await getGasPrice(),
      nonce: await getNonce(process.env.ETH_SIGNER1),
      data: multiSigWalletInstance.methods
        .submitTransaction(wslpAddress, 0, callAbi)
        .encodeABI(),
    };
    const signedTx = await web3.eth.accounts.signTransaction(
      tx,
      process.env.ETH_SIGNER1_PRIVATE_KEY
    );

    await web3.eth.sendSignedTransaction(
      signedTx.raw || signedTx.rawTransaction
    );
  } catch (err) {
    console.error("Error in submitMultiSigTransaction: ", err);
  }
}

async function confirmMultisigTransaction(from, privateKey, txId) {
  try {
    const tx = {
      from: from,
      to: process.env.MULTI_SIG_WALLET,
      gas: process.env.GAS_LIMIT,
      value: 0,
      gasPrice: await getGasPrice(),
      nonce: await getNonce(from),
      data: multiSigWalletInstance.methods.confirmTransaction(txId).encodeABI(),
    };
    const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);

    await web3.eth.sendSignedTransaction(
      signedTx.raw || signedTx.rawTransaction
    );

    console.log(`Transaction with id=${txId} was confirmed by ${from}`);
  } catch (err) {
    console.error("Error in confirmMultisigTransaction: ", err);
  }
}

function subscribeOnWslpUnlockRequest(wslpAddress) {
  try {
    const wslpTokenInstance = new web3.eth.Contract(wslpAbi, wslpAddress);

    wslpTokenInstance.events.SlpUnlockRequested(
      {},
      async function (error, event) {
        await executeQuery(
          connection,
          `INSERT INTO wslpToSlpRequests (account, amount, wslpTokenAddress, slpDestAddress) VALUES ('${event.returnValues._account}', '${event.returnValues._amount}', '${event.returnValues._token}', '${event.returnValues._slpAddr}')`,
          async function () {
            try {
              console.log(event.returnValues._slpAddr + " " + Buffer.from(event.returnValues._slpAddr, "hex").toString("ascii"));
              console.log(event.returnValues._amount);
              console.log(event.returnValues._token  + " " +  Buffer.from(event.returnValues._token, "hex").toString("ascii"));
              await bch.createSignAndSendMultiSigTransaction(
                event.returnValues._slpAddr,
                event.returnValues._amount,
                event.returnValues._token
              );
            } catch (err) {
              console.error("Error in subscribeOnWslpUnlockRequest: ", err);
            }
          }
        );
      }
    );
  } catch (err) {
    console.error("Error in subscribeOnWslpUnlockRequest: ", err);
  }
}

module.exports = {
  getWslpAddressForSlpAddress,
  submitMultiSigTransaction,
  web3,
};
