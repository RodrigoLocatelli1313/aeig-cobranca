#!/usr/bin/env bash
# Demonstração do fluxo completo (uns 2 minutos de conversa).
# Sobe o servidor num banco temporário, percorre os endpoints e derruba tudo no final.
set -u
cd "$(dirname "$0")/.."
PORT=3999 SEGREDO=segredo-demo
B=http://localhost:3999
DB=$(mktemp -d)/demo.db

PORT=$PORT DB_PATH=$DB WEBHOOK_SECRET=$SEGREDO node --disable-warning=ExperimentalWarning src/server.ts >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -s $B/saude >/dev/null && break; sleep 0.2; done

passo() { printf '\n\033[1m# %s\033[0m\n' "$1"; }
json()  { curl -s -w '  [HTTP %{http_code}]\n' -H 'Content-Type: application/json' "$@"; }
assina() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$SEGREDO" | awk '{print $NF}'; }

passo "1. Cadastra associado"
json -X POST $B/associados -d '{"nome":"Maria Souza","cpf":"529.982.247-25","valor_mensalidade":189.90}'
passo "2. CPF inválido (dígito verificador errado)"
json -X POST $B/associados -d '{"nome":"Fulano","cpf":"529.982.247-24","valor_mensalidade":100}'
passo "3. Mesmo CPF de novo -> 409"
json -X POST $B/associados -d '{"nome":"Maria de novo","cpf":"52998224725","valor_mensalidade":100}'
passo "4. Gera cobrança de 2026-10"
json -X POST $B/cobrancas -d '{"associado_id":1,"mes_referencia":"2026-10"}'
passo "5. Mesma cobrança de novo -> 409"
json -X POST $B/cobrancas -d '{"associado_id":1,"mes_referencia":"2026-10"}'

EVT='{"id_evento":"evt_000123","nosso_numero":"00000001","data_pagamento":"2026-10-15"}'
passo "6. Webhook SEM assinatura -> 401"
json -X POST $B/webhooks/pagamento -d "$EVT"
passo "7. Webhook assinado -> PAGA"
json -X POST $B/webhooks/pagamento -H "X-Assinatura: $(assina "$EVT")" -d "$EVT"
passo "8. Banco reenvia o mesmo aviso -> duplicado (nada muda)"
json -X POST $B/webhooks/pagamento -H "X-Assinatura: $(assina "$EVT")" -d "$EVT"
passo "9. Consulta a cobrança"
json $B/cobrancas/00000001
passo "10. Nosso número inexistente -> 404 (servidor segue de pé)"
EVT2='{"id_evento":"evt_999","nosso_numero":"99999999","data_pagamento":"2026-10-15"}'
json -X POST $B/webhooks/pagamento -H "X-Assinatura: $(assina "$EVT2")" -d "$EVT2"
json $B/saude
