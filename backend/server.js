const http = require("http");
require("dotenv/config");
const { validateRequiredEnv } = require("./src/config/env");

validateRequiredEnv();

const { app } = require("./src/app");
const { initSocket } = require("./src/config/socket");
require("./src/config/db");

const server = http.createServer(app);

initSocket(server);

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
