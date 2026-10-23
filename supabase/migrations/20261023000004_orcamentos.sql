-- =====================================================================
-- Atratis Approval · Etapa 3 · Orçamentos de mídia
-- Um orçamento por cliente e mês de referência (campanha opcional),
-- com versões. Cada versão tem linhas por plataforma, e o cliente
-- aprova a versão inteira.
--
-- Decisões de 23/10/2026:
--   * Sem honorários no orçamento.
--   * O valor de cada linha é o valor do boleto. O único imposto é o do
--     Meta Ads (12,15%), já incluso no boleto e calculado "por dentro":
--     verba = valor / 1,1215 e imposto = valor - verba
--     (boleto de R$ 1.100,00 = R$ 980,83 para anúncios + R$ 119,17).
--   * Basta um aprovador da empresa decidir.
--   * Mudou depois de enviado: versão nova, que precisa de nova aprovação.
--   * Status só muda pelas funções de fluxo, nunca direto na tabela.
-- =====================================================================

create type public.orcamento_status as enum (
  'rascunho', 'aguardando_aprovacao', 'em_analise', 'alteracoes_solicitadas',
  'em_revisao_interna', 'aprovado', 'cancelado');

create type public.orcamento_versao_status as enum (
  'rascunho', 'pendente', 'aprovado', 'alteracoes_solicitadas', 'substituida');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.budgets (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete restrict,
  campaign_id           uuid references public.campaigns (id) on delete set null,
  mes_referencia        date not null,
  titulo                text,
  instrucoes_cliente    text,
  responsavel_id        uuid references public.profiles (id) on delete set null,
  status                public.orcamento_status not null default 'rascunho',
  enviado_em            timestamptz,
  visualizado_em        timestamptz,
  concluido_em          timestamptz,
  cancelado_em          timestamptz,
  motivo_cancelamento   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  constraint budgets_mes_chk check (extract(day from mes_referencia) = 1),
  constraint budgets_titulo_chk check (titulo is null or length(btrim(titulo)) between 1 and 200)
);
create index budgets_client_idx on public.budgets (client_id, mes_referencia desc);
create index budgets_status_idx on public.budgets (status);

-- Observações internas do orçamento, invisíveis para o cliente.
create table public.budget_internal (
  budget_id             uuid primary key references public.budgets (id) on delete cascade,
  observacoes_internas  text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

create table public.budget_versions (
  id           uuid primary key default gen_random_uuid(),
  budget_id    uuid not null references public.budgets (id) on delete cascade,
  numero       integer not null,
  status       public.orcamento_versao_status not null default 'rascunho',
  observacao   text,
  enviado_em   timestamptz,
  decidido_em  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  constraint budget_versions_numero_uq unique (budget_id, numero)
);

create table public.budget_lines (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.budget_versions (id) on delete cascade,
  plataforma  text not null,
  descricao   text,
  -- Valor do boleto, com imposto incluso.
  valor       numeric(14, 2) not null,
  -- Alíquota definida pelo banco conforme a plataforma (gatilho), guardada
  -- na linha para o histórico não mudar se a alíquota mudar no futuro.
  aliquota    numeric(6, 4) not null default 0,
  imposto     numeric(14, 2) generated always as (round(valor - valor / (1 + aliquota), 2)) stored,
  verba       numeric(14, 2) generated always as (valor - round(valor - valor / (1 + aliquota), 2)) stored,
  ordem       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint budget_lines_plataforma_chk check (length(btrim(plataforma)) between 1 and 80),
  constraint budget_lines_descricao_chk check (descricao is null or length(descricao) <= 200),
  constraint budget_lines_valor_chk check (valor > 0 and valor < 1000000000),
  constraint budget_lines_aliquota_chk check (aliquota >= 0 and aliquota < 1)
);
create index budget_lines_version_idx on public.budget_lines (version_id, ordem);

-- Decisões do cliente. Imutáveis: só a função decidir_orcamento grava.
create table public.budget_approvals (
  id          bigint generated always as identity primary key,
  version_id  uuid not null references public.budget_versions (id) on delete restrict,
  budget_id   uuid not null references public.budgets (id) on delete restrict,
  client_id   uuid not null references public.clients (id) on delete restrict,
  decisao     text not null,
  comentario  text,
  total       numeric(14, 2) not null,
  user_id     uuid,
  user_email  text,
  user_nome   text,
  created_at  timestamptz not null default now(),
  constraint budget_approvals_decisao_chk check (decisao in ('aprovado', 'alteracoes_solicitadas')),
  constraint budget_approvals_comentario_chk check (
    decisao = 'aprovado' or length(btrim(coalesce(comentario, ''))) >= 3)
);
create index budget_approvals_budget_idx on public.budget_approvals (budget_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

-- Alíquota de imposto por plataforma. Hoje só o Meta Ads tem (12,15%).
create or replace function private.aliquota_plataforma(p_plataforma text)
returns numeric
language sql immutable set search_path = ''
as $$ select case when lower(btrim(coalesce(p_plataforma, ''))) = 'meta ads' then 0.1215 else 0 end::numeric $$;

create or replace function private.budget_client(p_budget uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select client_id from public.budgets where id = p_budget $$;

create or replace function private.version_budget(p_version uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select budget_id from public.budget_versions where id = p_version $$;

-- Equipe interna com acesso ao cliente do orçamento.
create or replace function private.staff_pode_orcamento(p_budget uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_staff() and private.has_client_access(private.budget_client(p_budget)) $$;

-- Cliente com acesso à empresa e orçamento já enviado.
create or replace function private.cliente_ve_orcamento(p_budget uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.budgets b
                 where b.id = p_budget and b.status <> 'rascunho'
                   and private.has_client_access(b.client_id))
$$;

create or replace function private.orcamento_editavel(p_budget uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.budgets b where b.id = p_budget and b.status <> 'cancelado') $$;

-- Versão atual (a de maior número) do orçamento.
create or replace function private.versao_atual_orcamento(p_budget uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.budget_versions where budget_id = p_budget order by numero desc limit 1 $$;

grant execute on function
  private.aliquota_plataforma(text), private.budget_client(uuid), private.version_budget(uuid),
  private.staff_pode_orcamento(uuid), private.cliente_ve_orcamento(uuid), private.orcamento_editavel(uuid),
  private.versao_atual_orcamento(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------

-- Status e datas do fluxo só mudam dentro das funções de fluxo (app.transicao).
create or replace function private.bloquear_status_orcamento()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.enviado_em := null;
    if tg_table_name = 'budgets' then
      new.visualizado_em := null; new.concluido_em := null;
      new.cancelado_em := null; new.motivo_cancelamento := null;
    else
      new.decidido_em := null;
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'O status muda só pelo fluxo de aprovação (enviar, decidir ou cancelar).'
      using errcode = '42501';
  end if;
  new.enviado_em := old.enviado_em;
  if tg_table_name = 'budgets' then
    new.visualizado_em := old.visualizado_em; new.concluido_em := old.concluido_em;
    new.cancelado_em := old.cancelado_em; new.motivo_cancelamento := old.motivo_cancelamento;
  else
    new.decidido_em := old.decidido_em;
  end if;
  return new;
end;
$$;

-- Cliente do orçamento não muda, e a campanha precisa ser do mesmo cliente.
create or replace function private.validar_orcamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.client_id <> old.client_id then
    raise exception 'O cliente do orçamento não pode ser trocado. Crie outro orçamento.' using errcode = '42501';
  end if;
  if new.campaign_id is not null and not exists (
       select 1 from public.campaigns c where c.id = new.campaign_id and c.client_id = new.client_id) then
    raise exception 'A campanha escolhida é de outro cliente.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Todo orçamento nasce com a versão 1 em rascunho.
create or replace function private.criar_primeira_versao()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.budget_versions (budget_id, numero) values (new.id, 1);
  return new;
end;
$$;

-- Versão: só a observação do rascunho pode mudar fora do fluxo; nunca é apagada.
create or replace function private.proteger_versao_orcamento()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Versão de orçamento não pode ser apagada.' using errcode = '42501';
  end if;
  if old.status <> 'rascunho' then
    raise exception 'Versão já enviada ao cliente não pode ser alterada. Crie uma versão nova.'
      using errcode = '42501';
  end if;
  if new.budget_id <> old.budget_id or new.numero <> old.numero then
    raise exception 'Não é possível mover a versão.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Linhas: só na versão em rascunho; a alíquota vem da plataforma.
create or replace function private.preparar_linha_orcamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.orcamento_versao_status;
begin
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'Não é possível mover a linha para outra versão.' using errcode = '42501';
  end if;
  select status into v_status from public.budget_versions where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'rascunho' then
    raise exception 'Esta versão já foi enviada ao cliente. Crie uma versão nova para mudar valores.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.plataforma := btrim(new.plataforma);
  new.descricao := nullif(btrim(coalesce(new.descricao, '')), '');
  new.aliquota := private.aliquota_plataforma(new.plataforma);
  return new;
end;
$$;

create trigger budgets_status before insert or update on public.budgets
  for each row execute function private.bloquear_status_orcamento();
create trigger budgets_validar before insert or update on public.budgets
  for each row execute function private.validar_orcamento();
create trigger budgets_created_by before insert on public.budgets
  for each row execute function private.stamp_created_by();
create trigger budgets_updated_at before update on public.budgets
  for each row execute function private.set_updated_at();
create trigger budgets_primeira_versao after insert on public.budgets
  for each row execute function private.criar_primeira_versao();
create trigger budgets_audit after insert or update or delete on public.budgets
  for each row execute function private.audit_row('orcamento', 'client_id');

create trigger budget_internal_by before insert or update on public.budget_internal
  for each row execute function private.stamp_updated_by();
create trigger budget_internal_at before update on public.budget_internal
  for each row execute function private.set_updated_at();

create trigger budget_versions_status before insert or update on public.budget_versions
  for each row execute function private.bloquear_status_orcamento();
create trigger budget_versions_protect before update or delete on public.budget_versions
  for each row execute function private.proteger_versao_orcamento();
create trigger budget_versions_created_by before insert on public.budget_versions
  for each row execute function private.stamp_created_by();
create trigger budget_versions_updated_at before update on public.budget_versions
  for each row execute function private.set_updated_at();

create trigger budget_lines_prepare before insert or update or delete on public.budget_lines
  for each row execute function private.preparar_linha_orcamento();
create trigger budget_lines_updated_at before update on public.budget_lines
  for each row execute function private.set_updated_at();

-- Auditoria das tabelas filhas: o cliente vem do orçamento.
create or replace function private.audit_orcamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_budget uuid;
  v_actor uuid := private.actor_id();
  v_det jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  v_budget := coalesce(nullif(v_row ->> 'budget_id', '')::uuid,
                       private.version_budget(nullif(v_row ->> 'version_id', '')::uuid));
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(to_jsonb(new)) loop
      if v_key not in ('updated_at', 'updated_by')
         and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key,
          jsonb_build_object('de', to_jsonb(old) -> v_key, 'para', to_jsonb(new) -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
    v_det := jsonb_build_object('alteracoes', v_changes, 'budget_id', v_budget);
  else
    v_det := jsonb_build_object('registro', v_row - 'created_at' - 'updated_at', 'budget_id', v_budget);
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, client_id, details)
  values (v_actor, (select p.email from public.profiles p where p.id = v_actor),
          tg_argv[0] || case tg_op when 'INSERT' then '.criado' when 'UPDATE' then '.alterado' else '.removido' end,
          tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'budget_id'), private.budget_client(v_budget), v_det);
  return coalesce(new, old);
end;
$$;

create trigger budget_internal_audit after insert or update on public.budget_internal
  for each row execute function private.audit_orcamento('orcamento.observacoes');
create trigger budget_versions_audit after insert or update on public.budget_versions
  for each row execute function private.audit_orcamento('orcamento.versao');
create trigger budget_lines_audit after insert or update or delete on public.budget_lines
  for each row execute function private.audit_orcamento('orcamento.linha');
create trigger budget_approvals_audit after insert on public.budget_approvals
  for each row execute function private.audit_orcamento('orcamento.decisao');

create trigger budget_approvals_immutable before update or delete on public.budget_approvals
  for each row execute function private.registro_imutavel();

-- ---------------------------------------------------------------------
-- Funções de fluxo (chamadas pelo site via RPC)
-- ---------------------------------------------------------------------

create or replace function public.enviar_orcamento(p_budget uuid)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao public.budget_versions%rowtype;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status = 'cancelado' then
    raise exception 'Orçamento cancelado não pode ser enviado.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clients c where c.id = v_b.client_id and c.ativo) then
    raise exception 'O cliente está inativo.' using errcode = 'P0001';
  end if;
  select * into v_versao from public.budget_versions where id = private.versao_atual_orcamento(p_budget) for update;
  if v_versao.status <> 'rascunho' then
    raise exception 'Esta versão já foi enviada. Crie uma versão nova para mudar valores.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.budget_lines l where l.version_id = v_versao.id) then
    raise exception 'Adicione pelo menos uma linha antes de enviar.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.budget_versions set status = 'pendente', enviado_em = now() where id = v_versao.id;
  update public.budgets
     set status = 'aguardando_aprovacao', enviado_em = now(), visualizado_em = null, concluido_em = null
   where id = p_budget;
  perform set_config('app.transicao', '', true);
  return 'aguardando_aprovacao';
end;
$$;

-- Nova versão: copia as linhas da versão atual para um rascunho novo.
-- Se a atual ainda aguardava o cliente, ela fica "substituída".
create or replace function public.nova_versao_orcamento(p_budget uuid, p_observacao text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_atual public.budget_versions%rowtype;
  v_nova uuid;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status = 'cancelado' then
    raise exception 'Orçamento cancelado não pode ter versão nova.' using errcode = 'P0001';
  end if;
  select * into v_atual from public.budget_versions where id = private.versao_atual_orcamento(p_budget) for update;
  if v_atual.status = 'rascunho' then
    raise exception 'Já existe uma versão em rascunho. Edite essa versão.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  if v_atual.status = 'pendente' then
    update public.budget_versions set status = 'substituida' where id = v_atual.id;
  end if;
  insert into public.budget_versions (budget_id, numero, status, observacao)
  values (p_budget, v_atual.numero + 1, 'rascunho', nullif(btrim(coalesce(p_observacao, '')), ''))
  returning id into v_nova;
  insert into public.budget_lines (version_id, plataforma, descricao, valor, ordem)
  select v_nova, l.plataforma, l.descricao, l.valor, l.ordem
    from public.budget_lines l where l.version_id = v_atual.id;
  update public.budgets set status = 'em_revisao_interna', concluido_em = null where id = p_budget;
  perform set_config('app.transicao', '', true);
  return v_nova;
end;
$$;

create or replace function public.cancelar_orcamento(p_budget uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.budgets
     set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   where id = p_budget and status <> 'cancelado';
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.registrar_visualizacao_orcamento(p_budget uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.cliente_ve_orcamento(p_budget) then
    return;
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.budgets
     set visualizado_em = now(), status = 'em_analise'
   where id = p_budget and status = 'aguardando_aprovacao';
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.decidir_orcamento(p_budget uuid, p_decisao text, p_comentario text default null)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_v public.budget_versions%rowtype;
  v_eu public.profiles%rowtype;
  v_total numeric(14, 2);
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.can_approve(v_b.client_id) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  if v_b.status not in ('aguardando_aprovacao', 'em_analise') then
    raise exception 'Este orçamento não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  select * into v_v from public.budget_versions where id = private.versao_atual_orcamento(p_budget) for update;
  if v_v.status <> 'pendente' then
    raise exception 'Este orçamento não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  if p_decisao not in ('aprovado', 'alteracoes_solicitadas') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if p_decisao = 'alteracoes_solicitadas' and length(btrim(coalesce(p_comentario, ''))) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.' using errcode = 'P0001';
  end if;

  select coalesce(sum(valor), 0) into v_total from public.budget_lines where version_id = v_v.id;
  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.budget_approvals (version_id, budget_id, client_id, decisao, comentario, total, user_id, user_email, user_nome)
  values (v_v.id, v_b.id, v_b.client_id, p_decisao, nullif(btrim(coalesce(p_comentario, '')), ''), v_total,
          v_eu.id, v_eu.email, v_eu.nome);

  perform set_config('app.transicao', 'on', true);
  update public.budget_versions set status = p_decisao::public.orcamento_versao_status, decidido_em = now() where id = v_v.id;
  update public.budgets
     set status = p_decisao::public.orcamento_status, concluido_em = now(),
         visualizado_em = coalesce(visualizado_em, now())
   where id = v_b.id;
  perform set_config('app.transicao', '', true);
  return p_decisao::public.orcamento_status;
end;
$$;

revoke all on function public.enviar_orcamento(uuid), public.nova_versao_orcamento(uuid, text),
  public.cancelar_orcamento(uuid, text), public.registrar_visualizacao_orcamento(uuid),
  public.decidir_orcamento(uuid, text, text) from public, anon;
grant execute on function public.enviar_orcamento(uuid), public.nova_versao_orcamento(uuid, text),
  public.cancelar_orcamento(uuid, text), public.registrar_visualizacao_orcamento(uuid),
  public.decidir_orcamento(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.budgets          enable row level security;
alter table public.budget_internal  enable row level security;
alter table public.budget_versions  enable row level security;
alter table public.budget_lines     enable row level security;
alter table public.budget_approvals enable row level security;

create policy budgets_select on public.budgets for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and private.has_client_access(client_id)));
create policy budgets_insert on public.budgets for insert to authenticated
  with check (private.is_staff() and private.has_client_access(client_id));
create policy budgets_update on public.budgets for update to authenticated
  using (private.is_staff() and private.has_client_access(client_id) and status <> 'cancelado')
  with check (private.is_staff() and private.has_client_access(client_id));

create policy budget_internal_select on public.budget_internal for select to authenticated
  using (private.staff_pode_orcamento(budget_id));
create policy budget_internal_insert on public.budget_internal for insert to authenticated
  with check (private.staff_pode_orcamento(budget_id));
create policy budget_internal_update on public.budget_internal for update to authenticated
  using (private.staff_pode_orcamento(budget_id)) with check (private.staff_pode_orcamento(budget_id));

create policy budget_versions_select on public.budget_versions for select to authenticated
  using (private.staff_pode_orcamento(budget_id)
         or (status <> 'rascunho' and private.cliente_ve_orcamento(budget_id)));
create policy budget_versions_update on public.budget_versions for update to authenticated
  using (private.staff_pode_orcamento(budget_id) and private.orcamento_editavel(budget_id))
  with check (private.staff_pode_orcamento(budget_id));

create policy budget_lines_select on public.budget_lines for select to authenticated
  using (private.staff_pode_orcamento(private.version_budget(version_id))
         or (private.cliente_ve_orcamento(private.version_budget(version_id))
             and exists (select 1 from public.budget_versions v
                         where v.id = budget_lines.version_id and v.status <> 'rascunho')));
create policy budget_lines_insert on public.budget_lines for insert to authenticated
  with check (private.staff_pode_orcamento(private.version_budget(version_id))
              and private.orcamento_editavel(private.version_budget(version_id)));
create policy budget_lines_update on public.budget_lines for update to authenticated
  using (private.staff_pode_orcamento(private.version_budget(version_id))
         and private.orcamento_editavel(private.version_budget(version_id)))
  with check (private.staff_pode_orcamento(private.version_budget(version_id)));
create policy budget_lines_delete on public.budget_lines for delete to authenticated
  using (private.staff_pode_orcamento(private.version_budget(version_id))
         and private.orcamento_editavel(private.version_budget(version_id)));

create policy budget_approvals_select on public.budget_approvals for select to authenticated
  using (private.has_client_access(client_id));

revoke all on public.budgets, public.budget_internal, public.budget_versions,
  public.budget_lines, public.budget_approvals from anon;
revoke delete, truncate on public.budgets, public.budget_internal from authenticated;
revoke insert, delete, truncate on public.budget_versions from authenticated;
revoke insert, update, delete, truncate on public.budget_approvals from authenticated;
revoke truncate on public.budget_lines from authenticated;
