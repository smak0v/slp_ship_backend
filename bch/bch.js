"use strcit";

const BCHJS = require("@psf/bch-js");

const { executeQuery, connection } = require("../database/db");
const eth = require("../eth/eth");
const BITBOXSDK = require("bitbox-sdk");

const BITBOX = new BITBOXSDK.BITBOX({
  restURL: "https://rest.bitcoin.com/v2/",
});

const { BitboxNetwork } = require("slpjs/index");
const bitboxNetwork = new BitboxNetwork(BITBOX);

const BCHN_MAINNET = "https://bchn.fullstack.cash/v3/";
const WATCH_INTERVAL = 1000 * 60 * 1.5;

const bchjs = new BCHJS({ restURL: BCHN_MAINNET });

loopProcessUtxos();

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const utxosWithTxDetails = await bitboxNetwork.getUtxoWithTxDetails(
    process.env.BCH_SIGNER1_ADDRESS
  );

  for (let i = 0; i < utxosWithTxDetails.length; i++) {
    if (utxosWithTxDetails[i].satoshis >= process.env.MIN_BCH_VALUE) {
      const opReturn = await parseUtxo(utxosWithTxDetails[i]);

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
    for (let i = 0; i < utxo.tx.vout.length; i++) {
      const script = bchjs.Script.toASM(
        Buffer.from(utxo.tx.vout[i].scriptPubKey.hex, "hex")
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
        const txData = await bitboxNetwork.getTransactionDetails(
          utxosInfo[i].tx_hash
        );

        // TODO check
      }
      if (
        utxosInfo[i].tx_hash === data.slpTxId &&
        utxosInfo[i].utxoType === "token" &&
        utxosInfo[i].tokenId !== undefined
      ) {
        const address = await eth.getWslpAddressForSlpAddress(utxosInfo[i]);

        if (address !== undefined) {
          await eth.submitMultiSigTransaction(
            address,
            data.ethDestAddress,
            new eth.web3.utils.BN(
              utxosInfo[i].tokenQty * 10 ** utxosInfo[i].decimals
            ),
            data.slpTxId
          );
        }
      }
    }
  } catch (err) {
    console.error("Error in processSLPTransaction: ", err);
  }
}
