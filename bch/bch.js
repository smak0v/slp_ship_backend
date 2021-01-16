const { executeQuery, connection } = require("../database/db");
const BCHJS = require("@psf/bch-js");

const BCHN_MAINNET = "https://bchn.fullstack.cash/v3/";

let bchjs = new BCHJS({ restURL: BCHN_MAINNET });

async function processUtxos() {
  try {
    const balance = await bchjs.Electrumx.utxo(process.env.BCH_SIGNER1_ADDRESS);

    for (i = 0; i < balance.utxos.length; ++i) {
      if (balance.utxos[i].value >= process.env.MIN_BCH_VALUE) {
        const opReturn = await parseUtxo(balance.utxos[i]);
        console.log(opReturn);

        if (opReturn) {
          let result = executeQuery(
            connection,
            `SELECT * FROM slpToWslpRequests WHERE slpTxId='${opReturn[1]}'`
          );
          console.log(result);
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
    let txDetails = await bchjs.OpenBazaar.tx(utxo.tx_hash);
    let txData = await bchjs.RawTransactions.getRawTransaction(
      txDetails.txid,
      true
    );

    for (i = 0; i < txData.vout.length; ++i) {
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

processUtxos();
