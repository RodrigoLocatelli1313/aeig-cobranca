import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp, type OpcoesApp } from "../src/app.ts";
import { abrirBanco } from "../src/db.ts";

export type Ambiente = {
  url: string;
  fechar: () => Promise<void>;
  post: (caminho: string, corpo: unknown, cabecalhos?: Record<string, string>) => Promise<{ status: number; json: any }>;
  postBruto: (caminho: string, texto: string, cabecalhos?: Record<string, string>) => Promise<{ status: number; json: any }>;
  get: (caminho: string) => Promise<{ status: number; json: any }>;
};

/** Sobe a API num banco em memória, numa porta livre, só para este teste. */
export async function subirApi(opcoes: OpcoesApp = {}): Promise<Ambiente> {
  const db = abrirBanco(":memory:");
  const servidor: Server = criarApp(db, { silencioso: true, ...opcoes });
  await new Promise<void>((ok) => servidor.listen(0, ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const ler = async (r: Response) => ({ status: r.status, json: await r.json() });
  const postBruto = (caminho: string, texto: string, cabecalhos: Record<string, string> = {}) =>
    fetch(url + caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhos },
      body: texto,
    }).then(ler);

  return {
    url,
    postBruto,
    post: (caminho, corpo, cabecalhos) => postBruto(caminho, JSON.stringify(corpo), cabecalhos),
    get: (caminho) => fetch(url + caminho).then(ler),
    fechar: () =>
      new Promise<void>((ok) => {
        servidor.close(() => {
          db.close();
          ok();
        });
      }),
  };
}

// CPFs válidos (gerados pela regra dos dígitos verificadores).
export const CPF_A = "529.982.247-25";
export const CPF_B = "111.444.777-35";
