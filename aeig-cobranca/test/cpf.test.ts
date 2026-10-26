import test from "node:test";
import assert from "node:assert/strict";
import { cpfValido } from "../src/cpf.ts";

test("CPF válido com e sem máscara", () => {
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("52998224725"), true);
  assert.equal(cpfValido("111.444.777-35"), true);
});

test("CPF com dígito verificador errado", () => {
  assert.equal(cpfValido("529.982.247-24"), false);
  assert.equal(cpfValido("529.982.247-52"), false);
});

test("CPF com tamanho errado ou caracteres inválidos", () => {
  assert.equal(cpfValido(""), false);
  assert.equal(cpfValido("123"), false);
  assert.equal(cpfValido("5299822472"), false);
  assert.equal(cpfValido("529982247250"), false);
});

test("CPF com todos os dígitos iguais é inválido", () => {
  for (let d = 0; d <= 9; d++) assert.equal(cpfValido(String(d).repeat(11)), false);
});
