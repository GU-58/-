import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const viteCli = fileURLToPath(new URL("../../bin/vite.js", import.meta.resolve("vite")));
const children = [
  spawn(process.execPath, ["server/index.mjs"], { stdio: "inherit" }),
  spawn(process.execPath, [viteCli, ...process.argv.slice(2)], { stdio: "inherit" }),
];
let shuttingDown = false;

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start the development server:", error.message);
    stopChildren(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const exitCode = signal ? 1 : code ?? 1;
      stopChildren(exitCode);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopChildren());
}
