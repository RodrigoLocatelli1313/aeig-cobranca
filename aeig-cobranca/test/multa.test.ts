import test from "node:test";
import assert from "node:assert/strict";
import { calcularValorAtualizado } from "../src/multa.ts";

const VALOR = 189.9;
const VENC = "2026-10-05";

test("antes do vencimento (01/10): sem multa e sem juros", () => {
  assert.equal(calcularValorAtualizado(VALOR, VENC, "2026-10-01"), 189.9);
});

test("no dia do vencimento (05/10): sem multa e sem juros", () => {
  assert.equal(calcularValorAtualizado(VALOR, VENC, "2026-10-05"), 189.9);
});

test("1 dia de atraso (06/10): multa 2% + 1 dia de juros", () => {
  // 189,90 + 3,798 + 0,0627 = 193,7607
  assert.equal(calcularValorAtualizado(VALOR, VENC, "2026-10-06"), 193.76);
});

test("10 dias de atraso (15/10): multa única + 10 dias de juros simples", () => {
  // 189,90 + 3,798 + 0,6267 = 194,3247
  assert.equal(calcularValorAtualizado(VALOR, VENC, "2026-10-15"), 194.32);
});

test("multa é única: 1 dia e 30 dias diferem só pelos juros", () => {
  const d1 = calcularValorAtualizado(100, "2026-01-01", "2026-01-02"); // 102,033 -> 102,03
  const d30 = calcularValorAtualizado(100, "2026-01-01", "2026-01-31"); // 102,99  -> 102,99
  assert.equal(d1, 102.03);
  assert.equal(d30, 102.99);
});

test("virada de mês e de ano contam dias corridos", () => {
  // 2026-12-30 -> 2027-01-02 = 3 dias: 100 + 2 + 0,099 = 102,099 -> 102,10
  assert.equal(calcularValorAtualizado(100, "2026-12-30", "2027-01-02"), 102.1);
});

test("arredonda em centavos sem erro de ponto flutuante", () => {
  // R$ 0,50 com 1 dia de atraso: 50 + 1 (multa) + 0,0165 (juros) = 51,0165 centavos -> R$ 0,51
  assert.equal(calcularValorAtualizado(0.5, "2026-01-01", "2026-01-02"), 0.51);
});

test("data inválida lança erro claro (não devolve valor silenciosamente)", () => {
  assert.throws(() => calcularValorAtualizado(100, "2026-02-31", "2026-03-05"), /vencimento inválida/);
  assert.throws(() => calcularValorAtualizado(100, "2026-03-01", "05/03/2026"), /dataPagamento inválida/);
  assert.throws(() => calcularValorAtualizado(100, "", "2026-03-01"), RangeError);
});

test("valor inválido lança erro", () => {
  assert.throws(() => calcularValorAtualizado(-1, VENC, VENC), RangeError);
  assert.throws(() => calcularValorAtualizado(Number.NaN, VENC, VENC), RangeError);
});
