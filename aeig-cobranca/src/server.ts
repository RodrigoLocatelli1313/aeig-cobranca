import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { criarApp } from "./app.ts";
import { abrirBanco } from "./db.ts";

const porta = Number(process.env.PORT ?? 3000);
const caminhoBanco = process.env.DB_PATH ?? "data/cobranca.db";
const segredoWebhook = process.env.WEBHOOK_SECRET || undefined;

mkdirSync(dirname(caminhoBanco), { recursive: true });
const db = abrirBanco(caminhoBanco);
const servidor = criarApp(db, { segredoWebhook });

servidor.listen(porta, () => {
  console.log(`API de cobrança em http://localhost:${porta}`);
  console.log(`Banco: ${caminhoBanco}`);
  console.log(
    segredoWebhook
      ? "Webhook: exige assinatura HMAC-SHA256 (X-Assinatura)"
      : "Webhook: SEM assinatura (defina WEBHOOK_SECRET para exigir)",
  );
});

// Encerramento limpo (Ctrl+C): fecha o servidor e o banco.
for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    servidor.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
