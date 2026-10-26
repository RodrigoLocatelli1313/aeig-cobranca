// Parte B: valor atualizado de uma mensalidade paga com atraso.
//
// Regra:
//   - pagou até o vencimento (inclusive): sem multa e sem juros
//   - depois: multa ÚNICA de 2% + juros SIMPLES de 0,033% por dia corrido,
//     ambos sobre o valor ORIGINAL
//   - resultado arredondado em centavos
//
// Toda a conta é feita em CENTAVOS INTEIROS para não sofrer com erro de
// ponto flutuante (0.1 + 0.2 !== 0.3). 0,033% = 33 / 100.000.

const MS_POR_DIA = 86_400_000;

/** "AAAA-MM-DD" -> timestamp UTC; lança erro se não for uma data real. */
function paraUtc(data: string, nomeCampo: string): number {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(data);
  const ts = ok ? Date.parse(`${data}T00:00:00Z`) : NaN;
  // O round-trip rejeita datas "roladas" como 2026-02-31 (que viraria 03-03).
  if (Number.isNaN(ts) || new Date(ts).toISOString().slice(0, 10) !== data) {
    throw new RangeError(`${nomeCampo} inválida: use AAAA-MM-DD (recebido: "${data}")`);
  }
  return ts;
}

export function calcularValorAtualizado(
  valor: number,
  vencimento: string,
  dataPagamento: string,
): number {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new RangeError("valor deve ser um número maior ou igual a zero");
  }
  const centavos = Math.round(valor * 100);
  const diasAtraso = Math.round(
    (paraUtc(dataPagamento, "dataPagamento") - paraUtc(vencimento, "vencimento")) / MS_POR_DIA,
  );

  if (diasAtraso <= 0) return centavos / 100; // no prazo: nada a acrescentar

  // total = c + c*2% + c*0,033%*dias, tudo sobre denominador 100.000:
  //   c*100000 + c*2000 + c*33*dias   (dividido por 100000)
  const numerador = centavos * 100_000 + centavos * 2_000 + centavos * 33 * diasAtraso;
  const totalCentavos = Math.floor((numerador + 50_000) / 100_000); // arredonda meio para cima
  return totalCentavos / 100;
}
