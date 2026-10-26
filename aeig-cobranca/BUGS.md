# BUGS.md — Parte B: defeitos em `calcularValorAtualizado`

Regra de negócio: pagou até o vencimento → sem acréscimos. Depois do vencimento →
**multa única de 2%** + **juros simples de 0,033% por dia corrido**, ambos sobre o
**valor original**, arredondado em centavos.

## Defeitos encontrados

| # | Defeito | Onde | Efeito para o associado |
|---|---------|------|-------------------------|
| 1 | **Contagem a mais (off-by-one)**: o laço usa `i <= diasAtraso` e roda `diasAtraso + 1` vezes. | `for (let i = 0; i <= diasAtraso; i++)` | Quem paga **no dia do vencimento** (0 dias de atraso) entra no laço uma vez e é cobrado multa + juros mesmo estando em dia. Quem atrasa 1 dia é cobrado como se tivesse atrasado 2. |
| 2 | **Multa repetida**: a multa de 2% está *dentro* do laço, então é somada a cada volta. | `total + valor * 0.02` | A multa deveria ser cobrada **uma vez** (2%). Com 10 dias de atraso o laço roda 11 vezes e cobra **22%** de multa. É o defeito que mais pesa no valor: o associado paga dezenas de reais a mais. |
| 3 | **Juros compostos em vez de simples**: os juros são calculados sobre `total`, que já inclui multa e juros anteriores. | `total * 0.00033` | A regra manda juros simples sobre o valor original. O associado paga juros sobre multa e sobre juros. |
| 4 | **Sem arredondamento**: devolve frações de centavo (ex.: `193.760667`). | `return total` | Boleto/PIX não cobra fração de centavo; o valor mostrado, o valor cobrado e o valor conciliado deixam de bater. |
| 5 | **Datas inválidas passam em silêncio**: `new Date("lixo")` vira `NaN`, o laço nem executa e a função devolve o valor original, sem erro. | `new Date(...)` sem validação | Uma data digitada errada faz o sistema cobrar **sem multa e sem juros**, e ninguém percebe. Prejuízo silencioso para a associação. |

Observações:

- O caso "paga **antes** do vencimento" só funciona **por acidente**: os dias de atraso dão
  negativo e o laço não roda. Não por estar certo.
- Alguns erros se somam: o defeito 1 faz o laço rodar a mais e os defeitos 2 e 3 multiplicam o
  efeito em cada volta. Por isso o erro cresce rápido com os dias de atraso.

## Versão corrigida

Código completo em [`src/multa.ts`](src/multa.ts). Resumo da lógica:

```ts
function calcularValorAtualizado(valor: number, vencimento: string, dataPagamento: string): number {
  const centavos = Math.round(valor * 100);
  const diasAtraso = Math.round(
    (paraUtc(dataPagamento, "dataPagamento") - paraUtc(vencimento, "vencimento")) / 86_400_000,
  );

  if (diasAtraso <= 0) return centavos / 100; // no prazo: sem multa, sem juros

  // multa única 2% + juros simples 0,033%/dia, sobre o valor ORIGINAL.
  // Tudo em centavos inteiros, com denominador 100.000 (0,033% = 33/100.000).
  const numerador = centavos * 100_000 + centavos * 2_000 + centavos * 33 * diasAtraso;
  return Math.floor((numerador + 50_000) / 100_000) / 100; // arredonda meio para cima
}
```

O que mudou, defeito por defeito:

1. Sem laço: calcula-se `diasAtraso` e, se for `<= 0`, devolve-se o valor original.
2. A multa entra **uma única vez** (`centavos * 2_000`).
3. Os juros são `centavos * 33 * diasAtraso`: simples, sobre o valor original.
4. Cálculo em **centavos inteiros** + arredondamento explícito (evita também erro de ponto flutuante).
5. `paraUtc` valida o formato `AAAA-MM-DD` e rejeita datas inexistentes (`2026-02-31`), lançando
   `RangeError` com mensagem clara. Datas são tratadas em UTC, sem influência de fuso/horário de verão.

## Valores para R$ 189,90, vencimento em 05/10/2026

| Pagamento | Dias de atraso | Cálculo | **Valor correto** | O que a função original calculava |
|-----------|---------------:|---------|------------------:|----------------------------------:|
| 01/10/2026 | antes do vencimento | sem acréscimos | **R$ 189,90** | R$ 189,90 (certo por acidente) |
| 05/10/2026 | 0 (no vencimento) | sem acréscimos | **R$ 189,90** | R$ 193,760667 |
| 06/10/2026 | 1 | 189,90 + 3,798 + 0,0627 = 193,7607 | **R$ 193,76** | R$ 197,622608 |
| 15/10/2026 | 10 | 189,90 + 3,798 + 0,6267 = 194,3247 | **R$ 194,32** | R$ 232,437478 |

Memória de cálculo (15/10): multa = 189,90 × 2% = 3,798; juros = 189,90 × 0,033% × 10 = 0,62667;
total = 189,90 + 3,798 + 0,62667 = 194,32467 → **R$ 194,32**.

No pior caso da tabela, a função original cobrava **R$ 38,11 a mais** que o devido (232,44 contra 194,32).

Os quatro valores corretos, as bordas (mês/ano virando, meio centavo) e as datas inválidas estão
cobertos em [`test/multa.test.ts`](test/multa.test.ts).
