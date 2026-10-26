# API de cobrança — Teste prático AEIG

Mini-API em **TypeScript + Node.js** para cadastrar associados, gerar cobranças mensais e baixar
pagamentos por webhook (aviso do banco). Parte B (defeitos na função de multa/juros) está em
[`BUGS.md`](BUGS.md).

## Como rodar

Requisitos: **Node.js 22.18 ou superior** (roda TypeScript direto e traz SQLite embutido).

```bash
npm install        # só instala ferramentas de desenvolvimento (typescript e tipos)
npm start          # sobe em http://localhost:3000
```

Variáveis de ambiente (todas opcionais):

| Variável | Padrão | Para quê |
|----------|--------|----------|
| `PORT` | `3000` | porta HTTP |
| `DB_PATH` | `data/cobranca.db` | arquivo SQLite (criado sozinho) |
| `WEBHOOK_SECRET` | *(vazio)* | se definido, o webhook **exige** assinatura HMAC-SHA256 em `X-Assinatura` |

Outros comandos:

```bash
npm test             # 41 testes automatizados (node:test), banco em memória
npm run typecheck    # tsc --noEmit
bash scripts/demo.sh # percorre o fluxo completo com curl (sobe e derruba o servidor sozinho)
```

## Endpoints e exemplos (curl)

```bash
# 0) Lista de endpoints (também abre no navegador): GET http://localhost:3000/

# 1) Cadastrar associado -> 201
curl -X POST localhost:3000/associados -H 'Content-Type: application/json' \
  -d '{"nome":"Maria Souza","cpf":"529.982.247-25","valor_mensalidade":189.90}'

# 2) Gerar cobrança do mês -> 201 (status PENDENTE, nosso_numero "00000001")
curl -X POST localhost:3000/cobrancas -H 'Content-Type: application/json' \
  -d '{"associado_id":1,"mes_referencia":"2026-10"}'

# 3) Consultar cobrança -> 200
curl localhost:3000/cobrancas/00000001

# 4) Aviso de pagamento do banco -> 200 (cobrança vira PAGA)
curl -X POST localhost:3000/webhooks/pagamento -H 'Content-Type: application/json' \
  -d '{"id_evento":"evt_000123","nosso_numero":"00000001","data_pagamento":"2026-10-15"}'
```

Com `WEBHOOK_SECRET=segredo123`, o webhook precisa da assinatura (HMAC-SHA256 em hexadecimal do corpo exato):

```bash
BODY='{"id_evento":"evt_000123","nosso_numero":"00000001","data_pagamento":"2026-10-15"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac segredo123 | awk '{print $NF}')
curl -X POST localhost:3000/webhooks/pagamento -H 'Content-Type: application/json' \
  -H "X-Assinatura: $SIG" -d "$BODY"
```

### Respostas de erro

Sempre JSON no formato `{"codigo": "...", "mensagem": "..."}`.

| Situação | HTTP | `codigo` |
|----------|-----:|----------|
| JSON malformado / corpo não é objeto / URL com `%` inválido | 400 | `JSON_INVALIDO`, `URL_INVALIDA` |
| Campo ausente ou inválido | 422 | `CAMPO_INVALIDO`, `VALOR_INVALIDO`, `MES_INVALIDO`, `DATA_INVALIDA` |
| CPF com dígitos verificadores inválidos | 422 | `CPF_INVALIDO` |
| CPF já cadastrado | 409 | `CPF_DUPLICADO` |
| Cobrança do mesmo associado no mesmo mês | 409 | `COBRANCA_DUPLICADA` |
| Associado / cobrança / nosso número inexistente | 404 | `ASSOCIADO_NAO_ENCONTRADO`, `COBRANCA_NAO_ENCONTRADA` |
| Assinatura HMAC ausente ou errada | 401 | `ASSINATURA_INVALIDA` |
| Corpo acima de 100 KB | 413 | `CORPO_GRANDE_DEMAIS` |
| Erro inesperado | 500 | `ERRO_INTERNO` (o servidor continua no ar) |

Respostas do webhook com sucesso (sempre 200): `"resultado": "processado"`, `"duplicado"` ou `"ja_paga"`.

## Principais decisões

- **Sem framework e sem dependências de produção.** Usei só o que vem no Node (`node:http`,
  `node:sqlite`, `node:crypto`, `node:test`). O projeto fica pequeno, cada linha é explicável, e
  não há pacote de terceiros para manter. O custo: roteamento e validação são manuais (poucas linhas).
- **SQLite** pela simplicidade (um arquivo, sem instalar nada). O acesso é concentrado em poucas
  funções; trocar por PostgreSQL mexeria só nelas.
- **Dinheiro em centavos inteiros** no banco e nos cálculos; a API recebe e devolve reais com até
  2 casas. Evita erros de ponto flutuante.
- **CPF**: validação dos dois dígitos verificadores, rejeitando sequências repetidas
  (`111.111.111-11`). Guardado só com dígitos, então `529.982.247-25` e `52998224725` são o mesmo CPF.
- **Duplicidade garantida pelo banco** (`UNIQUE` em `cpf`, em `(associado_id, mes_referencia)` e em
  `nosso_numero`), não por "consultar antes e inserir depois", que tem brecha em requisições simultâneas.
  O erro do banco vira 409.
- **"Nosso número"**: id sequencial da cobrança com 8 dígitos (`00000042`), único por construção.
- **Webhook idempotente**: tabela `eventos_webhook` com `id_evento` como chave primária. Registrar o
  evento e baixar a cobrança acontecem na **mesma transação**. Reenvio devolve 200 `duplicado` sem
  alterar nada (há teste com 50 avisos simultâneos: só 1 é processado).
- **"Nosso número" inexistente → 404 e o evento não é gravado.** Assim, se o banco reenviar depois que a
  cobrança existir, o aviso funciona. Respondi 404 (e não 200) para o erro ficar visível para o banco.
- **Cobrança já paga recebendo outro `id_evento`** → 200 `ja_paga`, evento registrado, **data original
  mantida**. Não existe regra no enunciado; escolhi não sobrescrever o primeiro pagamento.
- **HMAC (bônus)**: só é exigido se `WEBHOOK_SECRET` estiver definido. A conta usa o **corpo bruto**
  (antes do `JSON.parse`) e `timingSafeEqual`. Aceita hexadecimal puro ou com prefixo `sha256=`.
- **Erros**: 400 para JSON quebrado, 422 para campo inválido, 409 para conflito, 404 para inexistente.
  Erro inesperado vira 500 genérico, sem vazar detalhes, e não derruba o processo.

## O que ficou faltando

- A função de multa/juros (`src/multa.ts`) está corrigida e testada, mas **não está ligada** à API:
  o enunciado não define vencimento nas cobranças nem pede calcular o valor pago.
- Sem paginação nem listagens (`GET /associados`, `GET /cobrancas`).
- Sem autenticação nas rotas (o enunciado dispensa) e sem proteção contra replay do webhook além do `id_evento`
  (por exemplo, janela de tempo com timestamp assinado).
- Sem migrações de banco (o esquema é criado na subida com `CREATE TABLE IF NOT EXISTS`).
- Sem Docker/CI. A suíte roda com `npm test`.

## Onde usei IA

Usei o **Claude (Anthropic)** para estruturar o projeto, escrever a primeira versão do código, dos
testes e da documentação, e para analisar os defeitos da Parte B. Li o código e rodei os testes e o
servidor por conta própria. Sou capaz de explicar cada arquivo.

## Estrutura

```
src/
  server.ts       ponto de entrada (porta, banco, segredo, encerramento limpo)
  app.ts          servidor HTTP e rotas
  http.ts         helpers: erro HTTP, leitura do corpo, validação de texto
  db.ts           abertura do SQLite e criação das tabelas
  cpf.ts          validação de CPF
  associados.ts   POST /associados
  cobrancas.ts    POST /cobrancas e GET /cobrancas/:nosso_numero
  webhook.ts      POST /webhooks/pagamento (idempotência, 404, HMAC)
  hmac.ts         assinatura HMAC-SHA256
  multa.ts        Parte B: cálculo corrigido de multa e juros
test/             testes automatizados (node:test)
BUGS.md           Parte B
```
