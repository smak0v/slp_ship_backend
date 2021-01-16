var mysql = require("mysql");

var connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "helloworld",
  database: "slp_ship",
});

connection.connect(function (err) {
  if (err) {
    console.log(err);
    throw err;
  }

  console.log("Connected to the database!");

  executeQuery(
    connection,
    `CREATE TABLE IF NOT EXISTS slpToWslpRequests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      slpTxId VARCHAR(255) NOT NULL UNIQUE,
      ethDestAddress VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );

  executeQuery(
    connection,
    `CREATE TABLE IF NOT EXISTS wslpToSlpRequests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ethTxId VARCHAR(255) NOT NULL UNIQUE,
      slpDestAddress VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );
});

function executeQuery(connection, query) {
  connection.query(query, function (err, result) {
    if (err) {
      throw err;
    }

    return result;
  });
}

module.exports = {
  executeQuery,
  connection,
};
