"use strcit";

const { HdBitcoinCashPayments } = require("@faast/bitcoin-cash-payments");
const { NetworkType } = require("@faast/payments-common");
const BCHJS = require("@psf/bch-js");

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
    const txData = await bchjs.RawTransactions.getRawTransaction(
      slpUtxo.tx_hash,
      true
    );

    for (let i = 0; i < txData.vout.length; i++) {
      const script = bchjs.Script.toASM(
        Buffer.from(txData.vout[i].scriptPubKey.hex, "hex")
      ).split(" ");

      if (script[0] !== "OP_RETURN") {
        continue;
      }

      return script[5];
    }
  } catch (err) {
    console.error("Error in parseUtxo: ", err);
  }
}
