import http, { type IncomingMessage, type ServerResponse } from "node:http";

const healthPort = Number(process.env.HEALTH_PORT ?? "9090");

const server = http
  .createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(healthPort, "0.0.0.0");

const interval = setInterval(() => {
  process.stdout.write("[simulator] dev scaffold running\n");
}, 5000);

const shutdown = () => {
  clearInterval(interval);
  server.close();
  process.stdout.write("[simulator] shutdown\n");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
