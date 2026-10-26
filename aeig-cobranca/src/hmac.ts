// Assinatura HMAC-SHA256 do webhook (bônus do teste).
// O banco calcula HMAC-SHA256(segredo, corpo_bruto) e envia em hexadecimal
// no cabeçalho X-Assinatura. Nós recalculamos e comparamos.
import { createHmac, timingSafeEqual } from "node:crypto";

export function assinar(segredo: string, corpoBruto: string): string {
  return createHmac("sha256", segredo).update(corpoBruto).digest("hex");
}

/** Aceita "abc123..." ou "sha256=abc123...". Compara em tempo constante. */
export function assinaturaValida(
  segredo: string,
  corpoBruto: string,
  cabecalho: string | undefined,
): boolean {
  if (!cabecalho) return false;
  const recebida = cabecalho.trim().replace(/^sha256=/i, "").toLowerCase();
  const esperada = assinar(segredo, corpoBruto);
  const a = Buffer.from(recebida, "utf8");
  const b = Buffer.from(esperada, "utf8");
  // timingSafeEqual exige o mesmo tamanho (e lança erro se diferente).
  return a.length === b.length && timingSafeEqual(a, b);
}
