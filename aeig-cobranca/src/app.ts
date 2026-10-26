// Monta o servidor HTTP: recebe requisição -> acha a rota -> chama a função certa.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { criarAssociado } from "./associados.ts";
import { buscarCobranca, criarCobranca } from "./cobrancas.ts";
import { ErroHttp, enviarJson, lerCorpo, parseJsonObjeto } from "./http.ts";
import { processarPagamento } from "./webhook.ts";

export type OpcoesApp = {
  /** Segredo HMAC do webhook. Sem ele, o webhook aceita qualquer origem. */
  segredoWebhook?: string;
  /** Desliga o log de erros inesperados (usado nos testes). */
  silencioso?: boolean;
};

export function criarApp(db: DatabaseSync, opcoes: OpcoesApp = {}): Server {
  async function rotear(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const metodo = req.method ?? "GET";
    const caminho = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

    // Página inicial: lista os endpoints para quem abrir a URL no navegador.
    if (metodo === "GET" && caminho === "/") {
      return enviarJson(res, 200, {
        nome: "API de cobrança AEIG",
        endpoints: [
          "GET  /saude",
          "POST /associados",
          "POST /cobrancas",
          "GET  /cobrancas/:nosso_numero",
          "POST /webhooks/pagamento",
        ],
        documentacao: "Veja o README.md para exemplos de chamadas",
      });
    }

    if (metodo === "GET" && caminho === "/saude") {
      return enviarJson(res, 200, { status: "ok" });
    }

    if (metodo === "POST" && caminho === "/associados") {
      const corpo = parseJsonObjeto(await lerCorpo(req));
      return enviarJson(res, 201, criarAssociado(db, corpo));
    }

    if (metodo === "POST" && caminho === "/cobrancas") {
      const corpo = parseJsonObjeto(await lerCorpo(req));
      return enviarJson(res, 201, criarCobranca(db, corpo));
    }

    const consulta = caminho.match(/^\/cobrancas\/([^/]+)$/);
    if (metodo === "GET" && consulta) {
      let nossoNumero: string;
      try {
        nossoNumero = decodeURIComponent(consulta[1]!);
      } catch {
        throw new ErroHttp(400, "URL_INVALIDA", "URL com codificação inválida");
      }
      return enviarJson(res, 200, buscarCobranca(db, nossoNumero));
    }

    if (metodo === "POST" && caminho === "/webhooks/pagamento") {
      // Corpo BRUTO: a assinatura HMAC é calculada sobre os bytes exatos recebidos.
      const bruto = await lerCorpo(req);
      const assinatura = req.headers["x-assinatura"];
      const r = processarPagamento(
        db,
        bruto,
        Array.isArray(assinatura) ? assinatura[0] : assinatura,
        { segredo: opcoes.segredoWebhook },
      );
      return enviarJson(res, r.status, r.corpo);
    }

    throw new ErroHttp(404, "ROTA_NAO_ENCONTRADA", `Rota ${metodo} ${caminho} não existe`);
  }

  return createServer((req, res) => {
    // O catch aqui é o que garante: nenhum erro derruba o processo.
    rotear(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.end();
      if (e instanceof ErroHttp) {
        // Corpo grande demais: não lemos o resto, então a conexão não pode ser reaproveitada.
        if (e.status === 413) res.setHeader("Connection", "close");
        return enviarJson(res, e.status, { codigo: e.codigo, mensagem: e.message });
      }
      if (!opcoes.silencioso) console.error("Erro inesperado:", e);
      return enviarJson(res, 500, { codigo: "ERRO_INTERNO", mensagem: "Erro interno do servidor" });
    });
  });
}
