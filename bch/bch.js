"use strcit";

const { HdBitcoinCashPayments } = require("@faast/bitcoin-cash-payments");
const { executeQuery, connection } = require("../database/db");
const { NetworkType } = require("@faast/payments-common");
const BCHJS = require("@psf/bch-js");
const eth = require("../eth/eth");

const payments = new HdBitcoinCashPayments({
  hdKey: process.env.BCH_SIGNER1_PUBKEY,
  network: NetworkType.Mainnet,
});

const BCHN_MAINNET = "https://bchn.fullstack.cash/v3/";

let bchjs = new BCHJS({ restURL: BCHN_MAINNET });

async function processUtxos() {
  try {
    const balance = await bchjs.Electrumx.utxo(process.env.BCH_SIGNER1_ADDRESS);
    const utxosInfo = await bchjs.SLP.Utils.tokenUtxoDetails(balance.utxos);

    for (let i = 0; i < balance.utxos.length; i++) {
      if (balance.utxos[i].value >= process.env.MIN_BCH_VALUE) {
        const opReturn = await parseUtxo(balance.utxos[i]);

        if (opReturn) {
          executeQuery(
            connection,
            `SELECT * FROM slpToWslpRequests WHERE slpTxId='${opReturn[1]}' AND processed='false'`,
            async function (results) {
              if (results.length == 0) {
                executeQuery(
                  connection,
                  `INSERT INTO slpToWslpRequests (slpTxId, ethDestAddress, processed) VALUES ('${opReturn[1]}', '${opReturn[2]}', 0)`,
                  function () {}
                );
              } else {
                await processSLPTransaction(results[0], utxosInfo);
              }
            }
          );
        }
      }
    }
  } catch (err) {
    console.error("Error in processUtxos: ", err);
    throw err;
  }
}

async function parseUtxo(utxo) {
  try {
    const txDetails = await payments.getTransactionInfo(utxo.tx_hash);
    const txData = await bchjs.RawTransactions.getRawTransaction(
      txDetails.data.txid,
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
        const address = eth.getWslpAddressForSlpAddress(utxosInfo[i]);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

processUtxos();
