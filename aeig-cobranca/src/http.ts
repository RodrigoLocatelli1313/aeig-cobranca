// Utilitários HTTP mínimos (sem framework).
import type { IncomingMessage, ServerResponse } from "node:http";

/** Erro "esperado": vira resposta HTTP com status, código e mensagem clara. */
export class ErroHttp extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export function enviarJson(res: ServerResponse, status: number, corpo: unknown): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texto),
  });
  res.end(texto);
}

const LIMITE_CORPO = 100 * 1024; // 100 KB: de sobra para esta API

/** Lê o corpo BRUTO (string). Precisamos dele cru para conferir a assinatura HMAC. */
export async function lerCorpo(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    total += (parte as Buffer).length;
    if (total > LIMITE_CORPO) {
      throw new ErroHttp(413, "CORPO_GRANDE_DEMAIS", "Corpo da requisição acima de 100 KB");
    }
    partes.push(parte as Buffer);
  }
  return Buffer.concat(partes).toString("utf8");
}

/** Converte texto em objeto JSON; aceita apenas objeto ({...}). */
export function parseJsonObjeto(texto: string): Record<string, unknown> {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new ErroHttp(400, "JSON_INVALIDO", "Corpo da requisição não é um JSON válido");
  }
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    throw new ErroHttp(400, "JSON_INVALIDO", "O corpo deve ser um objeto JSON");
  }
  return valor as Record<string, unknown>;
}

/** Exige string não vazia (após trim) com tamanho máximo. */
export function exigirTexto(
  corpo: Record<string, unknown>,
  campo: string,
  max = 200,
): string {
  const v = corpo[campo];
  if (typeof v !== "string" || v.trim() === "") {
    throw new ErroHttp(422, "CAMPO_INVALIDO", `Campo "${campo}" é obrigatório e deve ser texto`);
  }
  if (v.trim().length > max) {
    throw new ErroHttp(422, "CAMPO_INVALIDO", `Campo "${campo}" excede ${max} caracteres`);
  }
  return v.trim();
}
