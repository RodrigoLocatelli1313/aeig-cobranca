import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { assinar } from "../src/hmac.ts";
import { CPF_A, CPF_B, subirApi, type Ambiente } from "./helpers.ts";

describe("associados", () => {
  let api: Ambiente;
  before(async () => { api = await subirApi(); });
  after(() => api.fechar());

  test("cria associado (201), guarda CPF só com dígitos e devolve valor em reais", async () => {
    const r = await api.post("/associados", { nome: "Maria Souza", cpf: CPF_A, valor_mensalidade: 189.9 });
    assert.equal(r.status, 201);
    assert.equal(r.json.nome, "Maria Souza");
    assert.equal(r.json.cpf, "52998224725");
    assert.equal(r.json.valor_mensalidade, 189.9);
    assert.equal(typeof r.json.id, "number");
  });

  test("CPF com dígito verificador inválido: 422 CPF_INVALIDO", async () => {
    const r = await api.post("/associados", { nome: "X Y", cpf: "529.982.247-24", valor_mensalidade: 100 });
    assert.equal(r.status, 422);
    assert.equal(r.json.codigo, "CPF_INVALIDO");
    assert.match(r.json.mensagem, /CPF inválido/);
  });

  test("CPF repetido: 409 CPF_DUPLICADO (mesmo com máscara diferente)", async () => {
    const r = await api.post("/associados", { nome: "Outra Pessoa", cpf: "52998224725", valor_mensalidade: 50 });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, "CPF_DUPLICADO");
  });

  test("campos ausentes ou inválidos: 422", async () => {
    assert.equal((await api.post("/associados", { cpf: CPF_B, valor_mensalidade: 10 })).status, 422); // sem nome
    assert.equal((await api.post("/associados", { nome: "A B", valor_mensalidade: 10 })).status, 422); // sem cpf
    assert.equal((await api.post("/associados", { nome: "A B", cpf: CPF_B })).status, 422); // sem valor
    for (const valor of [0, -5, "100", 10.005, null]) {
      const r = await api.post("/associados", { nome: "A B", cpf: CPF_B, valor_mensalidade: valor });
      assert.equal(r.status, 422, `valor ${JSON.stringify(valor)}`);
      assert.equal(r.json.codigo, "VALOR_INVALIDO");
    }
  });

  test("valor que arredonda para zero centavos: 422 (não 500)", async () => {
    for (const v of [1e-9, 0.000001]) {
      const r = await api.post("/associados", { nome: "A B", cpf: CPF_B, valor_mensalidade: v });
      assert.equal(r.status, 422, `valor ${v}`);
    }
  });

  test("corpo acima de 100 KB: 413, e a API segue atendendo normalmente", async () => {
    const r = await fetch(api.url + "/associados", { method: "POST", body: "x".repeat(200_000) });
    assert.equal(r.status, 413);
    assert.equal((await r.json()).codigo, "CORPO_GRANDE_DEMAIS");
    assert.equal((await api.get("/saude")).status, 200);
  });

  test("URL com % malformado: 400 (não 500)", async () => {
    const r = await api.get("/cobrancas/%E0%A4%A");
    assert.equal(r.status, 400);
    assert.equal(r.json.codigo, "URL_INVALIDA");
  });

  test("JSON malformado: 400; corpo que não é objeto: 400", async () => {
    assert.equal((await api.postBruto("/associados", "{nome:")).status, 400);
    assert.equal((await api.postBruto("/associados", "[1,2]")).status, 400);
    assert.equal((await api.postBruto("/associados", "")).status, 400);
  });

  test("GET / lista os endpoints", async () => {
    const r = await api.get("/");
    assert.equal(r.status, 200);
    assert.equal(r.json.nome, "API de cobrança AEIG");
    assert.ok(r.json.endpoints.includes("POST /associados"));
  });

  test("rota inexistente: 404 em JSON", async () => {
    const r = await api.get("/nada");
    assert.equal(r.status, 404);
    assert.equal(r.json.codigo, "ROTA_NAO_ENCONTRADA");
  });
});

describe("cobranças", () => {
  let api: Ambiente;
  let id1: number;
  let id2: number;
  before(async () => {
    api = await subirApi();
    id1 = (await api.post("/associados", { nome: "Maria Souza", cpf: CPF_A, valor_mensalidade: 189.9 })).json.id;
    id2 = (await api.post("/associados", { nome: "João Lima", cpf: CPF_B, valor_mensalidade: 99.5 })).json.id;
  });
  after(() => api.fechar());

  test("gera cobrança (201): valor = mensalidade, PENDENTE, nosso número de 8 dígitos", async () => {
    const r = await api.post("/cobrancas", { associado_id: id1, mes_referencia: "2026-10" });
    assert.equal(r.status, 201);
    assert.equal(r.json.status, "PENDENTE");
    assert.equal(r.json.valor, 189.9);
    assert.equal(r.json.mes_referencia, "2026-10");
    assert.match(r.json.nosso_numero, /^\d{8}$/);
    assert.equal(r.json.data_pagamento, null);
  });

  test("nosso número é único entre cobranças", async () => {
    const a = await api.post("/cobrancas", { associado_id: id2, mes_referencia: "2026-10" });
    const b = await api.post("/cobrancas", { associado_id: id2, mes_referencia: "2026-11" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.json.nosso_numero, b.json.nosso_numero);
  });

  test("duas cobranças do mesmo associado no mesmo mês: 409", async () => {
    const r = await api.post("/cobrancas", { associado_id: id1, mes_referencia: "2026-10" });
    assert.equal(r.status, 409);
    assert.equal(r.json.codigo, "COBRANCA_DUPLICADA");
  });

  test("mesmo mês para associados diferentes é permitido; meses diferentes também", async () => {
    assert.equal((await api.post("/cobrancas", { associado_id: id1, mes_referencia: "2026-12" })).status, 201);
    assert.equal((await api.post("/cobrancas", { associado_id: id2, mes_referencia: "2026-12" })).status, 201);
  });

  test("associado inexistente: 404", async () => {
    const r = await api.post("/cobrancas", { associado_id: 9999, mes_referencia: "2026-10" });
    assert.equal(r.status, 404);
    assert.equal(r.json.codigo, "ASSOCIADO_NAO_ENCONTRADO");
  });

  test("mês fora do formato AAAA-MM: 422", async () => {
    for (const mes of ["2026-13", "2026-00", "10/2026", "2026-1", "2026-10-01", "", 202610, null]) {
      const r = await api.post("/cobrancas", { associado_id: id1, mes_referencia: mes });
      assert.equal(r.status, 422, `mes ${JSON.stringify(mes)}`);
      assert.equal(r.json.codigo, "MES_INVALIDO");
    }
  });

  test("associado_id inválido: 422", async () => {
    for (const v of ["1", 0, -1, 1.5, null]) {
      const r = await api.post("/cobrancas", { associado_id: v, mes_referencia: "2026-10" });
      assert.equal(r.status, 422, `associado_id ${JSON.stringify(v)}`);
    }
  });

  test("GET /cobrancas/:nosso_numero: 200 e 404", async () => {
    const criada = (await api.post("/cobrancas", { associado_id: id1, mes_referencia: "2027-01" })).json;
    const ok = await api.get(`/cobrancas/${criada.nosso_numero}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, criada);
    const nao = await api.get("/cobrancas/99999999");
    assert.equal(nao.status, 404);
    assert.equal(nao.json.codigo, "COBRANCA_NAO_ENCONTRADA");
  });
});

describe("webhook de pagamento", () => {
  let api: Ambiente;
  let nosso: string;
  let contador = 0;
  const evt = (extra: object = {}) => ({
    id_evento: `evt_${String(++contador).padStart(6, "0")}`,
    nosso_numero: nosso,
    data_pagamento: "2026-10-15",
    ...extra,
  });

  before(async () => {
    api = await subirApi();
    const a = (await api.post("/associados", { nome: "Maria Souza", cpf: CPF_A, valor_mensalidade: 189.9 })).json;
    nosso = (await api.post("/cobrancas", { associado_id: a.id, mes_referencia: "2026-10" })).json.nosso_numero;
  });
  after(() => api.fechar());

  test("marca a cobrança como PAGA e grava a data", async () => {
    const r = await api.post("/webhooks/pagamento", evt({ id_evento: "evt_000123" }));
    assert.equal(r.status, 200);
    assert.equal(r.json.resultado, "processado");
    const c = (await api.get(`/cobrancas/${nosso}`)).json;
    assert.equal(c.status, "PAGA");
    assert.equal(c.data_pagamento, "2026-10-15");
  });

  test("reenvio do MESMO id_evento não é reprocessado (nem altera dados)", async () => {
    const r = await api.post("/webhooks/pagamento", {
      id_evento: "evt_000123", nosso_numero: nosso, data_pagamento: "2026-11-30",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.resultado, "duplicado");
    assert.equal((await api.get(`/cobrancas/${nosso}`)).json.data_pagamento, "2026-10-15");
  });

  test("outro evento para cobrança já paga: 200 ja_paga, data original preservada", async () => {
    const r = await api.post("/webhooks/pagamento", evt({ data_pagamento: "2026-10-20" }));
    assert.equal(r.status, 200);
    assert.equal(r.json.resultado, "ja_paga");
    assert.equal((await api.get(`/cobrancas/${nosso}`)).json.data_pagamento, "2026-10-15");
  });

  test("nosso número inexistente: 404, sem derrubar o servidor, e evento NÃO fica gravado", async () => {
    const e = evt({ nosso_numero: "77777777" });
    const r = await api.post("/webhooks/pagamento", e);
    assert.equal(r.status, 404);
    assert.equal(r.json.codigo, "COBRANCA_NAO_ENCONTRADA");
    assert.equal((await api.get("/saude")).status, 200); // continua de pé
    // O banco reenvia o mesmo evento: continua 404 (e não "duplicado").
    assert.equal((await api.post("/webhooks/pagamento", e)).status, 404);
  });

  test("payload inválido: 422 (campos) e 400 (JSON)", async () => {
    assert.equal((await api.post("/webhooks/pagamento", { nosso_numero: nosso, data_pagamento: "2026-10-15" })).status, 422);
    assert.equal((await api.post("/webhooks/pagamento", { id_evento: "e1", data_pagamento: "2026-10-15" })).status, 422);
    for (const d of ["15/10/2026", "2026-02-31", "2026-10-15T10:00:00Z", ""]) {
      const r = await api.post("/webhooks/pagamento", evt({ data_pagamento: d }));
      assert.equal(r.status, 422, `data ${d}`);
    }
    assert.equal((await api.postBruto("/webhooks/pagamento", "{quebrado")).status, 400);
  });

  test("50 avisos simultâneos com o mesmo id_evento: só um é processado", async () => {
    const a2 = (await api.post("/associados", { nome: "João Lima", cpf: CPF_B, valor_mensalidade: 99.5 })).json;
    const n2 = (await api.post("/cobrancas", { associado_id: a2.id, mes_referencia: "2026-10" })).json.nosso_numero;
    const corpo = { id_evento: "evt_concorrente", nosso_numero: n2, data_pagamento: "2026-10-10" };
    const respostas = await Promise.all(
      Array.from({ length: 50 }, () => api.post("/webhooks/pagamento", corpo)),
    );
    const resultados = respostas.map((r) => r.json.resultado);
    assert.equal(resultados.filter((x) => x === "processado").length, 1);
    assert.equal(resultados.filter((x) => x === "duplicado").length, 49);
    assert.ok(respostas.every((r) => r.status === 200));
  });
});

describe("webhook com assinatura HMAC (WEBHOOK_SECRET definido)", () => {
  const SEGREDO = "segredo-de-teste";
  let api: Ambiente;
  let nosso: string;
  before(async () => {
    api = await subirApi({ segredoWebhook: SEGREDO });
    const a = (await api.post("/associados", { nome: "Maria Souza", cpf: CPF_A, valor_mensalidade: 189.9 })).json;
    nosso = (await api.post("/cobrancas", { associado_id: a.id, mes_referencia: "2026-10" })).json.nosso_numero;
  });
  after(() => api.fechar());

  const corpo = () => JSON.stringify({ id_evento: "evt_hmac_1", nosso_numero: nosso, data_pagamento: "2026-10-15" });

  test("sem cabeçalho X-Assinatura: 401 e nada é alterado", async () => {
    const r = await api.postBruto("/webhooks/pagamento", corpo());
    assert.equal(r.status, 401);
    assert.equal(r.json.codigo, "ASSINATURA_INVALIDA");
    assert.equal((await api.get(`/cobrancas/${nosso}`)).json.status, "PENDENTE");
  });

  test("assinatura errada: 401 (inclusive tamanho diferente)", async () => {
    const errada = assinar("outro-segredo", corpo());
    assert.equal((await api.postBruto("/webhooks/pagamento", corpo(), { "X-Assinatura": errada })).status, 401);
    assert.equal((await api.postBruto("/webhooks/pagamento", corpo(), { "X-Assinatura": "abc" })).status, 401);
  });

  test("assinatura válida sobre outro corpo (adulterado): 401", async () => {
    const assinaturaDoOriginal = assinar(SEGREDO, corpo());
    const adulterado = corpo().replace("2026-10-15", "2026-10-01");
    assert.equal((await api.postBruto("/webhooks/pagamento", adulterado, { "X-Assinatura": assinaturaDoOriginal })).status, 401);
  });

  test("assinatura válida: 200 (aceita também o prefixo sha256=)", async () => {
    const r = await api.postBruto("/webhooks/pagamento", corpo(), { "X-Assinatura": `sha256=${assinar(SEGREDO, corpo())}` });
    assert.equal(r.status, 200);
    assert.equal(r.json.resultado, "processado");
    assert.equal((await api.get(`/cobrancas/${nosso}`)).json.status, "PAGA");
  });
});
