import type { DatabaseSync } from "node:sqlite";
import { desfazer, ehViolacaoUnique } from "./db.ts";
import { ErroHttp, exigirTexto, parseJsonObjeto } from "./http.ts";
import { assinaturaValida } from "./hmac.ts";

type Opcoes = { segredo?: string };

function dataValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ts = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ts) && new Date(ts).toISOString().slice(0, 10) === s;
}

/**
 * Processa o aviso de pagamento do banco.
 * Retorna { status, corpo } com o código HTTP a responder.
 */
export function processarPagamento(
  db: DatabaseSync,
  corpoBruto: string,
  assinatura: string | undefined,
  { segredo }: Opcoes,
): { status: number; corpo: Record<string, unknown> } {
  // 1) Autenticidade (só se um segredo foi configurado): confere ANTES de
  //    olhar o conteúdo. Assinatura ruim = 401 e nada mais é feito.
  if (segredo && !assinaturaValida(segredo, corpoBruto, assinatura)) {
    throw new ErroHttp(401, "ASSINATURA_INVALIDA", "Assinatura ausente ou inválida no cabeçalho X-Assinatura");
  }

  // 2) Validação do conteúdo.
  const corpo = parseJsonObjeto(corpoBruto);
  const idEvento = exigirTexto(corpo, "id_evento", 100);
  const nossoNumero = exigirTexto(corpo, "nosso_numero", 50);
  const dataPagamento = exigirTexto(corpo, "data_pagamento", 10);
  if (!dataValida(dataPagamento)) {
    throw new ErroHttp(422, "DATA_INVALIDA", 'Campo "data_pagamento" deve ser uma data válida no formato AAAA-MM-DD');
  }

  // 3) Tudo numa transação: registrar o evento e baixar a cobrança são
  //    "tudo ou nada". Se algo falhar no meio, nada fica pela metade.
  db.exec("BEGIN IMMEDIATE");
  try {
    // 3a) Já vimos este id_evento? Então é reenvio: responde 200 e NÃO reprocessa.
    const jaProcessado = db
      .prepare("SELECT 1 AS ok FROM eventos_webhook WHERE id_evento = ?")
      .get(idEvento);
    if (jaProcessado) {
      db.exec("ROLLBACK");
      return {
        status: 200,
        corpo: { resultado: "duplicado", id_evento: idEvento, mensagem: "Evento já processado anteriormente; nada foi alterado" },
      };
    }

    // 3b) "Nosso número" inexistente: 404 e NÃO registramos o evento.
    //     Assim, se a cobrança for criada depois, o banco pode reenviar e funcionar.
    const cobranca = db
      .prepare("SELECT id, status FROM cobrancas WHERE nosso_numero = ?")
      .get(nossoNumero) as { id: number; status: string } | undefined;
    if (!cobranca) {
      db.exec("ROLLBACK");
      throw new ErroHttp(404, "COBRANCA_NAO_ENCONTRADA", `Cobrança com nosso número ${nossoNumero} não existe`);
    }

    // 3c) Registra o evento (a chave primária é a trava final contra duplicidade).
    db.prepare(
      "INSERT INTO eventos_webhook (id_evento, nosso_numero, data_pagamento, recebido_em) VALUES (?, ?, ?, ?)",
    ).run(idEvento, nossoNumero, dataPagamento, new Date().toISOString());

    // 3d) Cobrança já paga por OUTRO evento: guardamos o evento, mas não
    //     sobrescrevemos a data do primeiro pagamento.
    if (cobranca.status === "PAGA") {
      db.exec("COMMIT");
      return {
        status: 200,
        corpo: { resultado: "ja_paga", id_evento: idEvento, nosso_numero: nossoNumero, mensagem: "Cobrança já estava paga; data original mantida" },
      };
    }

    db.prepare(
      "UPDATE cobrancas SET status = 'PAGA', data_pagamento = ? WHERE id = ?",
    ).run(dataPagamento, cobranca.id);
    db.exec("COMMIT");

    return {
      status: 200,
      corpo: { resultado: "processado", id_evento: idEvento, nosso_numero: nossoNumero, status_cobranca: "PAGA", data_pagamento: dataPagamento },
    };
  } catch (e) {
    // Se a transação ainda estiver aberta (erro inesperado), desfaz.
    desfazer(db);
    if (ehViolacaoUnique(e)) {
      // Corrida rara: outro processo inseriu o mesmo id_evento entre o SELECT e o INSERT.
      return {
        status: 200,
        corpo: { resultado: "duplicado", id_evento: idEvento, mensagem: "Evento já processado anteriormente; nada foi alterado" },
      };
    }
    throw e;
  }
}
