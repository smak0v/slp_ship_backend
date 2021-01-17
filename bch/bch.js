"use strcit";

const { HdBitcoinCashPayments } = require("@faast/bitcoin-cash-payments");
const { NetworkType } = require("@faast/payments-common");
const BITBOXSDK = require("bitbox-sdk");
const BCHJS = require("@psf/bch-js");
const {
  BitboxNetwork,
  Slp,
  TransactionHelpers,
} = require("slpjs/index");

const { executeQuery, connection } = require("../database/db");
const eth = require("../eth/eth");

const payments = new HdBitcoinCashPayments({
  hdKey: process.env.BCH_SIGNER1_PUBKEY,
  network: NetworkType.Mainnet,
});

const BCHN_MAINNET = "https://bchn.fullstack.cash/v3/";
const WATCH_INTERVAL = 1000 * 60 * 1.5;

const bchjs = new BCHJS({ restURL: BCHN_MAINNET });

loopProcessUtxos();

async function loopProcessUtxos() {
  try {
    await processUtxos();
  } catch (err) {
    console.error("Error in processUtxos: ", err);
  } finally {
    setTimeout(loopProcessUtxos, WATCH_INTERVAL);
  }
}

async function processUtxos() {
  const balance = await bchjs.Electrumx.utxo(process.env.BCH_SIGNER1_ADDRESS);
  const slpUtxosInfo = await bchjs.SLP.Utils.tokenUtxoDetails(balance.utxos);

  for (let i = 0; i < balance.utxos.length; i++) {
    if (balance.utxos[i].value >= process.env.MIN_BCH_VALUE) {
      const opReturn = await parseUtxo(balance.utxos[i]);

      if (opReturn) {
        await executeQuery(
          connection,
          `SELECT * FROM slpToWslpRequests WHERE slpTxId='${opReturn[1]}'`,
          async function (results) {
            if (results.length == 0) {
              await executeQuery(
                connection,
                `INSERT INTO slpToWslpRequests (slpTxId, ethDestAddress, processed) VALUES ('${opReturn[1]}', '${opReturn[2]}', 0)`,
                async function () {
                  await processSLPTransaction(
                    { slpTxId: opReturn[1], ethDestAddress: opReturn[2] },
                    slpUtxosInfo
                  );
                }
              );
            } else {
              if (results[0].processed == 0) {
                await processSLPTransaction(results[0], slpUtxosInfo);
              }
            }
          }
        );
      }
    }
  }
}

async function parseUtxo(utxo) {
  try {
    const txData = await bchjs.RawTransactions.getRawTransaction(
      utxo.tx_hash,
      true
    );

    for (let i = 0; i < txData.vout.length; i++) {
      const script = bchjs.Script.toASM(
        Buffer.from(txData.vout[i].scriptPubKey.hex, "hex")
      ).split(" ");

      if (script[0] !== "OP_RETURN") {
        continue;
      }

      const opReturn1 = Buffer.from(script[1], "hex").toString("utf8");
      const opReturn2 = Buffer.from(script[2], "hex").toString("utf8");

      if (opReturn1 == process.env.OP_RETURN1) {
        return [opReturn1, opReturn2, script[3]];
      } else {
        return null;
      }
    }
  } catch (err) {
    console.error("Error in parseUtxo: ", err);
  }
}

async function processSLPTransaction(data, utxosInfo) {
  try {
    for (let i = 0; i < utxosInfo.length; i++) {
      if (utxosInfo[i].tx_hash === data.slpTxId) {
        // console.log(utxosInfo[i]);
        const amount = await parseSlpUtxo(utxosInfo[i]);
        const address = await eth.getWslpAddressForSlpAddress(utxosInfo[i]);

        await eth.submitMultiSigTransaction(
          address,
          data.ethDestAddress,
          new eth.web3.utils.BN(amount * 10 ** utxosInfo[i].decimals),
          data.slpTxId
        );
      }
    }
  } catch (err) {
    console.error("Error in processSLPTransaction: ", err);
  }
}

async function parseSlpUtxo(slpUtxo) {
  try {
    // console.log(slpUtxo.tokenQty);
    const txData = await bchjs.RawTransactions.getRawTransaction(
      slpUtxo.tx_hash,
      true
    );

    // console.log(txData.tokenQty);

    for (let i = 0; i < txData.vout.length; i++) {
      const script = bchjs.Script.toASM(
        Buffer.from(txData.vout[i].scriptPubKey.hex, "hex")
      ).split(" ");

      if (script[0] !== "OP_RETURN") {
        continue;
      }

      // console.log(script);
      return script[5];
    }
  } catch (err) {
    console.error("Error in parseUtxo: ", err);
  }
}

async function createSignAdnSendMultiSigTransaction(
  receiver,
  amount,
  slpToken
) {
  const BITBOX = new BITBOXSDK.BITBOX({
    restURL: "https://rest.bitcoin.com/v2/",
  });
  const bitboxNetwork = new BitboxNetwork(BITBOX);
  const helpers = new TransactionHelpers(new Slp(BITBOX));

  const pubkey_signer_1 = process.env.BCH_SIGNER1_PUBKEY;
  const pubkey_signer_2 = process.env.BCH_SIGNER2_PUBKEY;
  const pubkey_signer_3 = process.env.BCH_SIGNER3_PUBKEY;

  const wifs = [
    process.env.BCH_SIGNER1_WIF,
    process.env.BCH_SIGNER2_WIF,
    process.env.BCH_SIGNER3_WIF,
  ];

  const receiver = [receiver];
  const sendAmounts = [amount];

  const tokenInfo = await bitboxNetwork.getTokenInformation(slpToken);

  console.log("Token precision: " + tokenInfo.decimals.toString());

  let balances = await bitboxNetwork.getAllSlpBalancesAndUtxos(
    process.env.BCH_SIGNER1_SLP_ADDRESS
  );

  console.log(balances);

  if (balances.slpTokenBalances[slpToken] === undefined)
    console.log("You need to fund the address with tokens and BCH.");

  console.log(
    "Token balance: ",
    balances.slpTokenBalances[slpToken].toFixed() / 10 ** tokenInfo.decimals
  );

  let inputUtxos = balances.slpTokenUtxos[slpToken];
  inputUtxos = inputUtxos.concat(balances.nonSlpUtxos);

  let extraFee = (2 * 33 + 2 * 72 + 10) * inputUtxos.length;

  let unsignedTxnHex = helpers.simpleTokenSend({
    slpToken,
    sendAmounts,
    inputUtxos,
    tokenReceiverAddresses: receiver,
    changeReceiverAddress: process.env.BCH_SIGNER1_SLP_ADDRESS,
    extraFee,
  });

  let redeemData = helpers.build_P2SH_multisig_redeem_data(3, [
    pubkey_signer_1,
    pubkey_signer_2,
    pubkey_signer_3,
  ]);
  let scriptSigs = inputUtxos.map((txo, i) => {
    let sigData = redeemData.pubKeys.map((pk, j) => {
      if (wifs[j]) {
        return helpers.get_transaction_sig_p2sh(
          unsignedTxnHex,
          wifs[j],
          i,
          txo.satoshis,
          redeemData.lockingScript,
          redeemData.lockingScript
        );
      } else {
        return helpers.get_transaction_sig_filler(i, pk);
      }
    });
    return helpers.build_P2SH_multisig_scriptSig(redeemData, i, sigData);
  });

  let signedTxn = helpers.addScriptSigs(unsignedTxnHex, scriptSigs);
  let sendTxid = await bitboxNetwork.sendTx(signedTxn);

  console.log("SEND txn complete:", sendTxid);
}

module.exports = {
  createSignAdnSendMultiSigTransaction,
};
