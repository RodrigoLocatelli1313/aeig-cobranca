import type { DatabaseSync } from "node:sqlite";
import { cpfValido, somenteDigitos } from "./cpf.ts";
import { ehViolacaoUnique } from "./db.ts";
import { ErroHttp, exigirTexto } from "./http.ts";

type LinhaAssociado = {
  id: number;
  nome: string;
  cpf: string;
  valor_mensalidade_centavos: number;
  criado_em: string;
};

// O que a API devolve: valor em reais (número com 2 casas), CPF só dígitos.
function paraResposta(l: LinhaAssociado) {
  return {
    id: l.id,
    nome: l.nome,
    cpf: l.cpf,
    valor_mensalidade: l.valor_mensalidade_centavos / 100,
    criado_em: l.criado_em,
  };
}

/** Converte reais (ex.: 189.9) em centavos inteiros, rejeitando mais de 2 casas. */
function reaisParaCentavos(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    throw new ErroHttp(
      422,
      "VALOR_INVALIDO",
      'Campo "valor_mensalidade" deve ser um número maior que zero (ex.: 189.90)',
    );
  }
  const centavos = Math.round(valor * 100);
  if (Math.abs(valor * 100 - centavos) > 1e-6) {
    throw new ErroHttp(422, "VALOR_INVALIDO", 'Campo "valor_mensalidade" aceita no máximo 2 casas decimais');
  }
  if (centavos < 1) {
    throw new ErroHttp(422, "VALOR_INVALIDO", 'Campo "valor_mensalidade" deve ser de pelo menos R$ 0,01');
  }
  if (centavos > 100_000_000) {
    throw new ErroHttp(422, "VALOR_INVALIDO", 'Campo "valor_mensalidade" acima do limite permitido');
  }
  return centavos;
}

export function criarAssociado(db: DatabaseSync, corpo: Record<string, unknown>) {
  const nome = exigirTexto(corpo, "nome", 120);
  const cpfInformado = exigirTexto(corpo, "cpf", 20);
  const centavos = reaisParaCentavos(corpo.valor_mensalidade);

  if (!cpfValido(cpfInformado)) {
    throw new ErroHttp(422, "CPF_INVALIDO", "CPF inválido: confira os dígitos verificadores");
  }
  const cpf = somenteDigitos(cpfInformado); // guardamos só os dígitos

  try {
    const r = db
      .prepare(
        "INSERT INTO associados (nome, cpf, valor_mensalidade_centavos, criado_em) VALUES (?, ?, ?, ?)",
      )
      .run(nome, cpf, centavos, new Date().toISOString());
    const linha = db
      .prepare("SELECT * FROM associados WHERE id = ?")
      .get(Number(r.lastInsertRowid)) as LinhaAssociado;
    return paraResposta(linha);
  } catch (e) {
    // Confiamos na restrição UNIQUE do banco (e não num "SELECT antes"):
    // assim não existe brecha entre verificar e inserir.
    if (ehViolacaoUnique(e)) {
      throw new ErroHttp(409, "CPF_DUPLICADO", "Já existe um associado cadastrado com este CPF");
    }
    throw e;
  }
}
