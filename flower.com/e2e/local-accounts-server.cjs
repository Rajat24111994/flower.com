const { createLocalAccounts } = require("../lib/local-accounts");
const { createLocalServer } = require("../lib/local-server");
const path = require("node:path");
const accounts = createLocalAccounts();
const server = createLocalServer({ root: path.join(__dirname, ".."), localAccounts: accounts });
server.once("close", () => accounts.close());
server.listen(4174, "127.0.0.1");
