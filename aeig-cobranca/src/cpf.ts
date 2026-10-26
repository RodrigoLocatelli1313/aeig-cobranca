// Validação de CPF.
// Regra: o CPF tem 9 dígitos-base + 2 dígitos verificadores (DV).
// Cada DV é calculado com soma ponderada dos dígitos anteriores.

/** Remove máscara: "529.982.247-25" -> "52998224725". */
export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Calcula um dígito verificador a partir dos dígitos anteriores. */
function calcularDV(digitos: number[]): number {
  // Pesos começam em (quantidade de dígitos + 1) e vão diminuindo até 2.
  // Para o 1º DV (9 dígitos): pesos 10..2. Para o 2º DV (10 dígitos): 11..2.
  const pesoInicial = digitos.length + 1;
  const soma = digitos.reduce((acc, d, i) => acc + d * (pesoInicial - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/** true se o CPF (com ou sem máscara) tem 11 dígitos e DVs corretos. */
export function cpfValido(cpf: string): boolean {
  const s = somenteDigitos(cpf);
  if (s.length !== 11) return false;
  // "111.111.111-11" passa na conta dos DVs, mas não é um CPF válido.
  if (/^(\d)\1{10}$/.test(s)) return false;

  const d = s.split("").map(Number);
  const dv1 = calcularDV(d.slice(0, 9));
  const dv2 = calcularDV(d.slice(0, 10));
  return dv1 === d[9] && dv2 === d[10];
}
