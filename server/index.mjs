import dotenv from "dotenv";
import { createNovelServer } from "./app.mjs";

dotenv.config({ path: ".env.local" });

const server = createNovelServer({
  apiKey: process.env.AI_API_KEY,
  baseUrl: process.env.AI_BASE_URL,
  model: process.env.AI_MODEL,
});

server.listen(3001, "127.0.0.1", () => {
  console.log("Novel writing API listening at http://127.0.0.1:3001");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
