"use strcit";

const dotenvConfig = require("dotenv").config();

if (dotenvConfig.error) {
  throw dotenvConfig.error;
}

const http = require("http");
const db = require("./database/db");
const bchjs = require("./bch/bch");

const hostname = "127.0.0.1";
const port = 3000;

const server = http.createServer((req, res) => {});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
