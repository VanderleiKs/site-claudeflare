# Site institucional + painel — Angular 22 SSR no Cloudflare Workers

Uma única aplicação Angular com SSR, publicada como **Cloudflare Worker**:

- **Site público** renderizado no servidor (início, catálogo com filtro, produto, sobre, contato, 404), com SEO, sitemap e pedidos pelo WhatsApp;
- **Painel administrativo** em `/admin` (produtos, categorias, imagens, configurações do site, troca de senha);
- **API REST** no próprio Worker (Hono), banco **Cloudflare D1** (SQLite) e imagens no **Cloudflare R2**.

Não há servidor para manter: um Worker, um banco D1 e um bucket R2 por cliente.

Cliente de demonstração: a marca fictícia **Queijos da Serra** (dados ilustrativos).

---

## Arquitetura

```
Navegador ─► Cloudflare
              ├─ Workers Static Assets: JS, CSS, fontes, favicon (dist/site-ssr/browser) — sem executar o Worker
              └─ Worker (dist/site-ssr/server/server.mjs)
                   ├─ /api/*         Hono: auth, público, painel ──► D1 (binding DB)
                   ├─ /uploads/*     imagens ──────────────────────► R2 (binding MEDIA)
                   ├─ /robots.txt, /sitemap.xml
                   └─ demais rotas   Angular SSR ── REQUEST_CONTEXT ──► ContentService ──► D1
```

| Item | Escolha | Por quê |
|---|---|---|
| Runtime | Cloudflare Workers (`nodejs_compat`) | sem servidor; o Angular 22 SSR roda no runtime do Workers (`AngularAppEngine`, API fetch) |
| HTTP no Worker | Hono 4 | roteador feito para Workers (Request/Response padrão). O Express depende do servidor HTTP do Node |
| Banco | D1 | SQLite gerenciado; migrations com `wrangler d1 migrations` |
| Imagens | R2 | armazenamento de objetos; upload sempre passa pelo Worker (credenciais nunca vão ao navegador) |
| Senhas | PBKDF2-SHA256 (Web Crypto), 100.000 iterações | máximo permitido pelo Web Crypto do Workers; scrypt/argon2 não são viáveis no runtime |
| Validação | zod 4 | |
| Front-end | Angular 22, standalone, signals, zoneless, OnPush, Reactive Forms, Tailwind 4 | |

---

## Requisitos

- **Node.js 24 LTS** (≥ 24.15) ou 22 (≥ 22.22.3) — exigência do Angular 22
- Conta Cloudflare. **Recomendado: plano Workers Paid (US$ 5/mês)** — o plano gratuito limita cada requisição a 10 ms de CPU, e a renderização SSR do Angular e o hash de senha no login tendem a passar disso. No plano pago o limite padrão é 30 s.
- Nada mais: o D1 e o R2 locais são simulados pelo `wrangler dev`.

---

## Executar localmente

```bash
npm install
cp .dev.vars.example .dev.vars     # defina ADMIN_EMAIL e ADMIN_PASSWORD
npm run dev                        # http://localhost:8787  (painel em /admin)
```

O `npm run dev` aplica as migrations no D1 local, faz o build do Angular e sobe o `wrangler dev` (o mesmo runtime do Cloudflare, com D1 e R2 simulados em `.wrangler/state`). Ao salvar arquivos em `src/`, o build é refeito.

Na primeira requisição o Worker cria o administrador (a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`) e, com `SEED_DEMO=true`, o conteúdo de demonstração.

**Fluxo principal:** `/admin` → Produtos → Novo produto → preencha e envie a imagem → Cadastrar → "Ver no site". Edite e salve: ao recarregar a página, a alteração já aparece.

> O `ng serve` não é usado: sem as bindings D1/R2 ele não consegue atender (responde 503 com um aviso). O desenvolvimento acontece no `wrangler dev`.

---

## Publicar no Cloudflare (primeira vez)

```bash
npx wrangler login

# 1. Banco D1 — copie o "database_id" exibido para wrangler.jsonc (d1_databases[0].database_id)
npx wrangler d1 create site-institucional

# 2. Bucket R2 das imagens
npx wrangler r2 bucket create site-institucional-media

# 3. Edite "vars" em wrangler.jsonc:
#    PUBLIC_SITE_URL  → https://www.dominio-do-cliente.com.br  (ou a URL *.workers.dev no início)
#    ALLOWED_HOSTS    → outros hosts aceitos, ex.: dominio-do-cliente.com.br,site-institucional.SEU-SUBDOMINIO.workers.dev
#    SEED_DEMO        → "false" para cliente real

# 4. Administrador inicial (secrets — não ficam no repositório)
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD

# 5. Migrations no D1 remoto + build + deploy
npm run deploy
```

Depois de entrar no painel pela primeira vez: `npx wrangler secret delete ADMIN_PASSWORD`.

**Importante:** o SSR só atende hosts listados em `PUBLIC_SITE_URL`/`ALLOWED_HOSTS` (proteção contra SSRF do Angular). Um host fora da lista recebe erro 400.

### Domínio e HTTPS

Com o domínio já na Cloudflare: painel → *Workers & Pages* → o Worker → *Settings* → *Domains & Routes* → *Add* → *Custom domain* (ex.: `www.dominio-do-cliente.com.br`). O certificado HTTPS é emitido automaticamente. Alternativa no `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "www.dominio-do-cliente.com.br", "custom_domain": true }]
```

Atualize `PUBLIC_SITE_URL` para o domínio final e rode `npm run deploy`.

### Atualizações

`npm run deploy` (aplica migrations novas, faz o build e publica). Alterações de **conteúdo** feitas pelo painel não exigem deploy. Também é possível conectar o repositório em *Workers Builds* para publicar a cada push.

### Redefinir a senha do administrador

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_RESET_PASSWORD   # valor: true
# acesse o site uma vez (a senha é redefinida e as sessões encerradas) e depois:
npx wrangler secret delete ADMIN_RESET_PASSWORD
npx wrangler secret delete ADMIN_PASSWORD
```

---

## Backup

- **Banco:** o D1 tem *Time Travel* (restauração para qualquer minuto dos últimos 30 dias no plano pago: `npx wrangler d1 time-travel restore site-institucional --timestamp=...`). Para cópia externa: `npm run db:backup` (gera `backup-site.sql` via `wrangler d1 export`).
- **Imagens:** os objetos do R2 nunca são alterados (nomes UUID). Para cópia externa, crie um token R2 de leitura e use `rclone sync r2:site-institucional-media ./backup-imagens`.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Migrations locais + build + `wrangler dev` em http://localhost:8787 |
| `npm run build` | Build do Angular (`dist/site-ssr`: Worker em `server/`, arquivos estáticos em `browser/`) |
| `npm run deploy` | Migrations no D1 remoto + build + `wrangler deploy` |
| `npm run db:migrate:local` / `db:migrate:remote` | Aplica migrations (`migrations/*.sql`) |
| `npm run db:backup` | Exporta o D1 remoto para `backup-site.sql` |
| `npm test` | Testes do servidor + testes do Angular |
| `npm run test:server` | API, banco, autenticação, uploads (Vitest) |
| `npm run test:app` | Componentes e serviços Angular (`ng test`, Vitest) |
| `npm run test:ssr` | Smoke test contra o site no ar (padrão `http://localhost:8787`) |
| `npm run typecheck` | Verificação de tipos com TypeScript 7 |
| `npm run lint` / `format` | Typecheck + Prettier / formatação |

`test:ssr` com login: `E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:ssr` (ou `SITE_URL=https://... ` para testar o site publicado).

---

## Estrutura

```
wrangler.jsonc                 # Worker: bindings D1/R2, assets, variáveis, build
migrations/                    # SQL do D1 (0001_init.sql, ...)
src/
├── server.ts                  # entrada do Worker: Hono + Angular SSR + /uploads + robots/sitemap
├── server/                    # backend (roda no Worker)
│   ├── api.ts                 # /api/auth, /api/public, /api/admin
│   ├── services.ts            # composição das dependências + bootstrap (admin, seed)
│   ├── config.ts  platform.ts # variáveis do Worker e tipos das bindings
│   ├── crypto.ts              # PBKDF2, tokens, SHA-256 (Web Crypto)
│   ├── db/                    # interface Database, adaptador D1, adaptador SQLite p/ testes, seed
│   ├── storage/               # interface de armazenamento: R2 (produção) e memória (testes)
│   ├── auth/ catalog/ media/ settings/ content/ http/
│   └── testing/               # app de teste (Hono + SQLite em memória)
├── shared/                    # contratos usados pelo Worker e pelo Angular
└── app/                       # Angular
    ├── core/                  # ContentGateway (SSR x navegador), auth, admin-api, SEO, site, UI, utils
    ├── shared/ui/             # componentes reutilizáveis
    └── features/public|admin/ # layouts, páginas e componentes
```

Convenções: todo componente tem TypeScript e template separados (`nome.ts` + `nome.html`); standalone, `OnPush`, `inject()`, `input()`/`output()`, signals e `computed`; rotas por feature com *lazy loading*; nenhum código de `src/server` vai para o navegador.

### TypeScript 7

`tsc` do projeto é o **TypeScript 7.0.2**: `npm run typecheck` verifica todo o código (site, painel, Worker e testes). O **compilador do Angular 22 ainda exige TypeScript 6.0** (usa a API JavaScript do TypeScript, que o TS 7 não oferece), então o `ng build` usa o 6.0 internamente. O `tsconfig` é compatível com as duas versões.

---

## Como as alterações aparecem sem rebuild

1. As páginas públicas usam `RenderMode.Server`: o HTML é gerado **a cada requisição** pelo Worker. Nada é pré-renderizado no build.
2. No SSR o Angular **não faz requisição HTTP para si mesmo**: o `server.ts` passa o `ContentService` pelo `REQUEST_CONTEXT` e o `ServerContentGateway` consulta o D1 diretamente (registrando `PendingTasks`, para o SSR esperar os dados).
3. O resultado vai para o `TransferState`; no navegador, o `HttpContentGateway` reaproveita esse dado na hidratação (nenhuma chamada à API na carga inicial). Navegações seguintes usam `/api/public/*`.
4. Não há cache de conteúdo para invalidar: HTML e API pública saem com `Cache-Control: no-cache`; imagens (`/uploads/*`) têm nome único e cache `immutable`.
5. O painel (`/admin`) usa `RenderMode.Client`: o Worker entrega só o shell, sem dados nem consultas privadas no SSR.

---

## Segurança implementada

| Item | Como |
|---|---|
| Senhas | PBKDF2-SHA256, 100.000 iterações (limite do Workers), sal aleatório, comparação em tempo constante, política mínima de força |
| Sessão | token aleatório de 256 bits em cookie `HttpOnly`, `SameSite=Lax`; em produção `Secure` + prefixo `__Host-`; o D1 guarda só o SHA-256; logout e troca de senha encerram sessões |
| CSRF | cookie `XSRF-TOKEN` + cabeçalho `X-XSRF-TOKEN` (enviado pelo `HttpClient`) obrigatório em escritas; login só aceita JSON |
| Abuso de login | bloqueio da conta após N falhas e limite por IP (`CF-Connecting-IP`) guardados no D1 — valem para todas as instâncias do Worker |
| Autorização | `/api/admin/*` passa por `requireAuth` no Worker |
| Entrada | zod em todas as rotas; corpo JSON até 100 KB; consultas sempre parametrizadas |
| Uploads | só autenticado; até 5 MB (limite antes de ler o corpo); tipo pelo conteúdo (JPEG/PNG/WebP; SVG recusado); nome UUID; servidos com `nosniff` e CSP `sandbox` |
| Banco | chaves estrangeiras (`RESTRICT`/`SET NULL`), operações compostas em `batch` atômico do D1 |
| SSR | `allowedHosts`, painel fora do SSR, `X-Robots-Tag: noindex` no painel |
| Cabeçalhos | HSTS (produção), `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` |
| Segredos | `wrangler secret` em produção, `.dev.vars` local (fora do Git) |

---

## Reutilizar para outro cliente

1. Copie o repositório e mude `name`, `database_name` e `bucket_name` em `wrangler.jsonc`.
2. Siga "Publicar no Cloudflare" com `SEED_DEMO=false`.
3. Cadastre tudo pelo painel: nome, logotipo, cores, textos, contatos, SEO, categorias e produtos.

Ajustes opcionais em código: favicon (`public/favicon.svg`), `theme-color` (`src/index.html`), fontes (`src/styles.css`), rótulos como "Produtos" (`features/public/layout/site-header`) e o seed (`src/server/db/seed.ts`).

Novo campo configurável: `SiteSettingsInput` (`src/shared/models.ts`) → schema (`src/server/settings/settings.schema.ts`) → formulário (`features/admin/pages/settings`). Alterações de tabela: novo arquivo em `migrations/`.

---

## Limitações conhecidas

- O D1 não tem transações interativas; operações compostas (produto + galeria, mover produtos de categoria) usam `batch`, que é atômico.
- As imagens não são redimensionadas (não há `sharp` no Workers). Envie fotos com até ~2000 px; se precisar de miniaturas automáticas, ative o *Cloudflare Images / Image Resizing* no domínio.
- Não há envio de e-mail; a página de contato usa WhatsApp, telefone, `mailto:` e mapa.
