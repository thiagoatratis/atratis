# Atratis Approval

Portal de aprovação de criativos e orçamentos de mídia paga da Atratis Digital, com geração de Pedidos de Inserção (P.I.).

- **Front-end:** React + TypeScript (Vite)
- **Back-end:** Supabase (Auth com link mágico, Postgres com RLS, Storage, Edge Functions)

## Situação por etapa

| Etapa | O que entrega | Situação |
|---|---|---|
| 1. Base | Login por link mágico, perfis (admin, equipe, cliente), clientes, aprovadores por empresa, acesso da equipe por cliente, dados da agência, histórico imutável | Publicada (22/10/2026) |
| 2. Criativos | Solicitações, peças, upload, versões, aprovação por peça, link para avisar o cliente | Publicada (22/10/2026) |
| 3. Orçamentos | Orçamento mensal por cliente, linhas por plataforma com o valor do boleto, imposto do Meta Ads (12,15%) por dentro, versões, aprovação do orçamento inteiro | Publicada (23/10/2026) |
| 4. P.I. | Emissão a partir do orçamento aprovado (consolidado ou por plataforma), numeração AAMMDD.NN, PDF A4 no modelo da Atratis (Montserrat), prévia, e-mail para copiar, cliente baixa no portal | Pronta no código |
| 5. Painel | Indicadores, lista geral com filtros, histórico por solicitação | A fazer |

Nada na etapa 5 aparece na interface até estar funcionando de verdade.

## Configuração do Supabase (uma vez)

### 1. Banco de dados

No painel do Supabase, abra **SQL Editor** e rode, nesta ordem, o conteúdo de cada arquivo:

1. `supabase/migrations/20261022000001_base.sql`
2. `supabase/migrations/20261022000002_dados_iniciais.sql`

Com a Supabase CLI instalada, o equivalente é `supabase link` e depois `supabase db push`.

### 2. Login

Em **Authentication**:

- **Sign In / Providers → Email:** deixe ligado.
- **Desligue "Allow new users to sign up".** Só o administrador cria usuários, pelo próprio sistema.
- **URL Configuration:**
  - **Site URL:** o endereço onde o sistema vai ficar publicado.
  - **Redirect URLs:** esse mesmo endereço com `/**` no fim. Para testar na sua máquina, inclua também `http://localhost:5173/**`.
- **Emails → SMTP:** o envio padrão do Supabase só manda poucos e-mails por hora e serve apenas para teste. Antes de liberar para os clientes, configure um SMTP próprio (Google Workspace, Resend ou outro).
- **Emails → Templates → Magic Link:** o Supabase só libera a edição depois de configurar um SMTP próprio. Até lá vale o modelo padrão, só com o link; o site usa o login "implicit", e o link funciona em qualquer aparelho. Com o SMTP pronto, use o modelo abaixo, que acrescenta o código de 6 dígitos. A tela de entrada já aceita o código, em "O e-mail trouxe um código de acesso?":

  > **Assunto:** Seu código de acesso ao portal da Atratis
  >
  > ```html
  > <h2>Seu código de acesso ao portal da Atratis</h2>
  > <p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
  > <p>Digite este código na tela de entrada. Ele vale por 1 hora e só pode ser usado uma vez.</p>
  > <p>Se estiver no mesmo navegador em que pediu o acesso, também pode <a href="{{ .ConfirmationURL }}">entrar por este link</a>.</p>
  > <p>Se você não pediu este acesso, ignore este e-mail.</p>
  > ```

### 3. Primeiro administrador

1. Em **Authentication → Users → Add user → Create new user**, crie o seu usuário com o seu e-mail e marque **Auto Confirm User**.
2. No **SQL Editor**, rode:

   ```sql
   select private.promote_to_admin('seu-email@atratis.com.br');
   ```

Daqui em diante, os outros usuários são convidados pela tela **Usuários** do sistema.

### 4. Função de servidor `admin-users`

Ela cria usuários e define o perfil de cada um. É a única parte que usa a chave administrativa, que fica no Supabase e nunca vai para o navegador.

- **Pelo painel:** em **Edge Functions → Deploy a new function → Via Editor**, use o nome `admin-users`, cole o conteúdo de `supabase/functions/admin-users/index.ts` e desligue **Verify JWT**. A função confere sozinha se quem chama é um administrador ativo.
- **Pela CLI:** `supabase functions deploy admin-users --no-verify-jwt`.

As chaves já vêm preenchidas pelo próprio Supabase dentro da função: a função usa `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` e, se elas não existirem, as antigas `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.

## Rodar e publicar o front-end

### Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave anon / publishable
```

A chave **service_role / secret** nunca vai neste arquivo.

### Na sua máquina

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

### Publicação (Vercel)

1. Importe o repositório no Vercel. O framework é detectado como Vite.
2. Em **Environment Variables**, cadastre as duas variáveis acima.
3. Faça o deploy e coloque o endereço final na **Site URL** e nas **Redirect URLs** do Supabase.

O arquivo `vercel.json` já faz as rotas internas funcionarem ao recarregar a página e bloqueia indexação por buscadores.

## Segurança: como está garantido

- **RLS em todas as tabelas.** O cliente só enxerga empresas às quais o usuário dele foi vinculado individualmente; nunca pelo domínio do e-mail. Empresa inativa some para o cliente.
- **Papel do usuário** (admin, equipe, cliente):
  - vem de `app_metadata`, que só a função de servidor consegue gravar;
  - ninguém muda o próprio papel;
  - o sistema nunca fica sem administrador ativo.
- **Observações internas** ficam em tabela separada, invisível para clientes.
- **Histórico (`audit_log`)** é preenchido por gatilhos no banco e registra autor, data e hora. Ninguém consegue editar nem apagar, nem a chave de servidor, nem o administrador.
- **Visitante sem login** (papel `anon`) não tem acesso a nenhuma tabela.

## Testes

```bash
npm run test:db    # migrations + 66 verificações de permissão num Postgres local que imita o Supabase
npm run typecheck
npm run build
```

A cada push, o GitHub Actions roda os três, mais a checagem da função de servidor (`deno check`).
