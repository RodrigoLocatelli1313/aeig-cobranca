import type { DatabaseSync } from "node:sqlite";
import { desfazer, ehViolacaoUnique } from "./db.ts";
import { ErroHttp } from "./http.ts";

type LinhaCobranca = {
  id: number;
  nosso_numero: string;
  associado_id: number;
  mes_referencia: string;
  valor_centavos: number;
  status: "PENDENTE" | "PAGA";
  data_pagamento: string | null;
  criado_em: string;
};

function paraResposta(l: LinhaCobranca) {
  return {
    nosso_numero: l.nosso_numero,
    associado_id: l.associado_id,
    mes_referencia: l.mes_referencia,
    valor: l.valor_centavos / 100,
    status: l.status,
    data_pagamento: l.data_pagamento,
    criado_em: l.criado_em,
  };
}

/** AAAA-MM com mês de 01 a 12. */
const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "Nosso número" = id da cobrança com 8 dígitos (ex.: 00000042). Único por construção. */
function gerarNossoNumero(id: number): string {
  return String(id).padStart(8, "0");
}

export function criarCobranca(db: DatabaseSync, corpo: Record<string, unknown>) {
  const { associado_id: associadoId, mes_referencia: mes } = corpo;

  if (!Number.isInteger(associadoId) || (associadoId as number) <= 0) {
    throw new ErroHttp(422, "CAMPO_INVALIDO", 'Campo "associado_id" deve ser um inteiro positivo');
  }
  if (typeof mes !== "string" || !MES_REGEX.test(mes)) {
    throw new ErroHttp(422, "MES_INVALIDO", 'Campo "mes_referencia" deve estar no formato AAAA-MM (ex.: 2026-10)');
  }

  const associado = db
    .prepare("SELECT id, valor_mensalidade_centavos FROM associados WHERE id = ?")
    .get(associadoId as number) as { id: number; valor_mensalidade_centavos: number } | undefined;
  if (!associado) {
    throw new ErroHttp(404, "ASSOCIADO_NAO_ENCONTRADO", `Associado ${associadoId} não existe`);
  }

  // Transação: calcular o próximo id e inserir acontecem juntos.
  let nossoNumero: string;
  db.exec("BEGIN IMMEDIATE");
  try {
    const { proximo } = db
      .prepare("SELECT COALESCE(MAX(id), 0) + 1 AS proximo FROM cobrancas")
      .get() as { proximo: number };

    nossoNumero = gerarNossoNumero(proximo);
    db.prepare(
      `INSERT INTO cobrancas
         (id, nosso_numero, associado_id, mes_referencia, valor_centavos, status, criado_em)
       VALUES (?, ?, ?, ?, ?, 'PENDENTE', ?)`,
    ).run(
      proximo,
      nossoNumero,
      associado.id,
      mes,
      associado.valor_mensalidade_centavos, // valor da cobrança = mensalidade
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (e) {
    desfazer(db);
    // UNIQUE(associado_id, mes_referencia): já existe cobrança deste mês.
    if (ehViolacaoUnique(e)) {
      throw new ErroHttp(
        409,
        "COBRANCA_DUPLICADA",
        `Já existe cobrança do associado ${associadoId} para ${mes}`,
      );
    }
    throw e;
  }
  // Fora da transação: se a leitura falhar, não há o que desfazer.
  return buscarCobranca(db, nossoNumero);
}

export function buscarCobranca(db: DatabaseSync, nossoNumero: string) {
  const linha = db
    .prepare("SELECT * FROM cobrancas WHERE nosso_numero = ?")
    .get(nossoNumero) as LinhaCobranca | undefined;
  if (!linha) {
    throw new ErroHttp(404, "COBRANCA_NAO_ENCONTRADA", `Cobrança com nosso número ${nossoNumero} não existe`);
  }
  return paraResposta(linha);
}
