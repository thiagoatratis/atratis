# Atratis Approval

Portal de aprovação de criativos e orçamentos de mídia paga da Atratis Digital, com geração de Pedidos de Inserção (P.I.).

- **Front-end:** React + TypeScript (Vite)
- **Back-end:** Supabase (Auth com link mágico, Postgres com RLS, Storage, Edge Functions)

## Situação por etapa

| Etapa | O que entrega | Situação |
|---|---|---|
| 1. Base | Login por link mágico, perfis (admin, equipe, cliente), clientes, aprovadores por empresa, acesso da equipe por cliente, dados da agência, histórico imutável | Pronta no código, com testes de permissão. Falta configurar o Supabase (abaixo) |
| 2. Criativos | Solicitações, peças, upload, versões, aprovação por peça | A fazer |
| 3. Orçamentos | Linhas por canal, categorias (mídia, honorários, impostos), aprovação | A fazer |
| 4. P.I. | Numeração AAMMDD.NN, PDF A4 no modelo da Atratis, prévia, e-mail para copiar | A fazer |
| 5. Painel | Indicadores, lista geral com filtros, histórico por solicitação | A fazer |

Nada nas etapas 2 a 5 aparece na interface até estar funcionando de verdade.

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
- **Emails → Templates → Magic Link:** é opcional, mas vale traduzir o texto. Uma sugestão:

  > **Assunto:** Seu acesso ao portal de aprovações da Atratis
  >
  > Olá! Clique no link abaixo para entrar no portal de aprovações da Atratis Digital:
  > `<a href="{{ .ConfirmationURL }}">Entrar no portal</a>`
  > O link vale por pouco tempo e só funciona uma vez. Se você não pediu este acesso, ignore este e-mail.

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

As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já vêm preenchidas pelo próprio Supabase dentro da função.

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
