"use strcit";

var mysql = require("mysql");

var connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "helloworld",
  database: "slp_ship",
});

connection.connect(async function (err) {
  if (err) {
    console.log(err);
    throw err;
  }

  console.log("Connected to the database!");

  await executeQuery(
    connection,
    `CREATE TABLE IF NOT EXISTS slpToWslpRequests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slpTxId VARCHAR(255) NOT NULL UNIQUE,
      ethDestAddress VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed BOOLEAN NOT NULL
    )`,
    function () {}
  );

  await executeQuery(
    connection,
    `CREATE TABLE IF NOT EXISTS wslpToSlpRequests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(255) NOT NULL,
      amount INT NOT NULL,
      wslpTokenAddress VARCHAR(255) NOT NULL,
      slpDestAddress VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    function () {}
  );

  await executeQuery(
    connection,
    `CREATE TABLE IF NOT EXISTS slpToWslp (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slp VARCHAR(255) NOT NULL,
      wslp VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    function () {}
  );
});

async function executeQuery(connection, query, callback) {
  await connection.query(query, function (err, result) {
    if (err) {
      throw err;
    }

    return callback(result);
  });
}

module.exports = {
  executeQuery,
  connection,
};
