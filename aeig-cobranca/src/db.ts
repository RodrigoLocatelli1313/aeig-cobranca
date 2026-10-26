import { DatabaseSync } from "node:sqlite";

/** Abre o banco (arquivo, ou ":memory:" nos testes) e garante o esquema. */
export function abrirBanco(caminho: string): DatabaseSync {
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA foreign_keys = ON");
  if (caminho !== ":memory:") db.exec("PRAGMA journal_mode = WAL");

  // Valores em CENTAVOS (inteiro): dinheiro nunca em ponto flutuante.
  // As restrições UNIQUE são a garantia final contra duplicidade: mesmo que
  // duas requisições cheguem juntas, o banco recusa a segunda.
  db.exec(`
    CREATE TABLE IF NOT EXISTS associados (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      nome                        TEXT    NOT NULL,
      cpf                         TEXT    NOT NULL UNIQUE,
      valor_mensalidade_centavos  INTEGER NOT NULL CHECK (valor_mensalidade_centavos > 0),
      criado_em                   TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cobrancas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      nosso_numero    TEXT    NOT NULL UNIQUE,
      associado_id    INTEGER NOT NULL REFERENCES associados(id),
      mes_referencia  TEXT    NOT NULL,
      valor_centavos  INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGA')),
      data_pagamento  TEXT,
      criado_em       TEXT    NOT NULL,
      UNIQUE (associado_id, mes_referencia)
    );

    -- Um registro por aviso do banco já processado. A chave primária em
    -- id_evento é o que impede processar o mesmo aviso duas vezes.
    CREATE TABLE IF NOT EXISTS eventos_webhook (
      id_evento       TEXT PRIMARY KEY,
      nosso_numero    TEXT NOT NULL,
      data_pagamento  TEXT NOT NULL,
      recebido_em     TEXT NOT NULL
    );
  `);
  return db;
}

/** Desfaz a transação aberta; não faz nada (e não falha) se não houver uma. */
export function desfazer(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* nenhuma transação ativa */
  }
}

/** true se o erro é violação de UNIQUE/PK do SQLite (errcode 1555 ou 2067). */
export function ehViolacaoUnique(erro: unknown): boolean {
  return erro instanceof Error && /UNIQUE constraint failed/i.test(erro.message);
}
