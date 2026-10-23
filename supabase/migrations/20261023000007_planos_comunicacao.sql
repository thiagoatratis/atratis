-- =====================================================================
-- Atratis Approval · Etapa 5 · Plano de comunicação digital
--
-- O plano é montado no Claude Design e exportado em PDF. A equipe sobe o
-- PDF, divide as páginas em seções (Objetivos, Personas, Tom de voz...) e
-- envia. O cliente aprova ou pede ajuste em cada seção; ao pedir ajuste,
-- comenta e pode citar os slides a que se refere.
--
-- Decisões de 23/10/2026:
--   * Aprovação por seção do plano; a equipe marca as seções ao subir o PDF.
--   * Basta um aprovador da empresa decidir cada seção.
--   * Ajuste pedido: a equipe sobe uma versão nova; as seções já aprovadas
--     continuam aprovadas (se a equipe não as mudou) e o cliente revisa só
--     as que mudaram.
--   * Seções informativas (capa, sumário, encerramento) aparecem para o
--     cliente, mas não pedem decisão.
--   * Status só muda pelas funções de fluxo, nunca direto na tabela.
-- =====================================================================

create type public.plano_status as enum (
  'rascunho', 'aguardando_aprovacao', 'em_analise', 'ajustes_solicitados',
  'em_revisao_interna', 'aprovado', 'cancelado');

create type public.plano_versao_status as enum ('rascunho', 'pendente', 'concluida', 'substituida');

create type public.plano_secao_status as enum ('rascunho', 'pendente', 'aprovada', 'ajuste_solicitado', 'informativa');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.plans (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete restrict,
  titulo                text not null,
  instrucoes_cliente    text,
  responsavel_id        uuid references public.profiles (id) on delete set null,
  status                public.plano_status not null default 'rascunho',
  enviado_em            timestamptz,
  visualizado_em        timestamptz,
  concluido_em          timestamptz,
  cancelado_em          timestamptz,
  motivo_cancelamento   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  constraint plans_titulo_chk check (length(btrim(titulo)) between 1 and 200),
  constraint plans_instrucoes_chk check (instrucoes_cliente is null or length(instrucoes_cliente) <= 2000)
);
create index plans_client_idx on public.plans (client_id, created_at desc);
create index plans_status_idx on public.plans (status);

create table public.plan_versions (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.plans (id) on delete cascade,
  numero       integer not null,
  status       public.plano_versao_status not null default 'rascunho',
  -- Nota para o cliente: o que mudou nesta versão.
  observacao   text,
  pdf_path     text,
  paginas      integer,
  enviado_em   timestamptz,
  decidido_em  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  constraint plan_versions_numero_uq unique (plan_id, numero),
  constraint plan_versions_paginas_chk check (paginas is null or paginas between 1 and 500),
  constraint plan_versions_pdf_chk check ((pdf_path is null) = (paginas is null)),
  constraint plan_versions_observacao_chk check (observacao is null or length(observacao) <= 2000)
);

create table public.plan_sections (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references public.plan_versions (id) on delete cascade,
  ordem             integer not null,
  nome              text not null,
  pagina_inicio     integer not null,
  pagina_fim        integer not null,
  requer_aprovacao  boolean not null default true,
  -- Seção aprovada numa versão anterior que esta repete sem mudança:
  -- a aprovação é mantida e o cliente não precisa decidir de novo.
  mantem_aprovacao_de uuid references public.plan_sections (id) on delete restrict,
  status            public.plano_secao_status not null default 'rascunho',
  decidido_em       timestamptz,
  created_at        timestamptz not null default now(),
  constraint plan_sections_ordem_uq unique (version_id, ordem),
  constraint plan_sections_nome_chk check (length(btrim(nome)) between 1 and 120),
  constraint plan_sections_paginas_chk check (pagina_inicio >= 1 and pagina_fim >= pagina_inicio),
  constraint plan_sections_mantem_chk check (mantem_aprovacao_de is null or requer_aprovacao)
);
create index plan_sections_version_idx on public.plan_sections (version_id, ordem);

-- Decisões do cliente por seção. Imutáveis: só a função decidir_secao_plano grava.
create table public.plan_section_decisions (
  id          bigint generated always as identity primary key,
  section_id  uuid not null references public.plan_sections (id) on delete restrict,
  version_id  uuid not null references public.plan_versions (id) on delete restrict,
  plan_id     uuid not null references public.plans (id) on delete restrict,
  client_id   uuid not null references public.clients (id) on delete restrict,
  secao_nome  text not null,
  decisao     text not null,
  comentario  text,
  slides      integer[] not null default '{}',
  user_id     uuid,
  user_email  text,
  user_nome   text,
  created_at  timestamptz not null default now(),
  constraint plan_decisions_decisao_chk check (decisao in ('aprovada', 'ajuste_solicitado')),
  constraint plan_decisions_comentario_chk check (
    decisao = 'aprovada' or length(btrim(coalesce(comentario, ''))) >= 3),
  constraint plan_decisions_comentario_len_chk check (comentario is null or length(comentario) <= 4000)
);
create index plan_decisions_plan_idx on public.plan_section_decisions (plan_id, created_at desc);
create index plan_decisions_section_idx on public.plan_section_decisions (section_id, created_at desc);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

create or replace function private.plan_client(p_plan uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select client_id from public.plans where id = p_plan $$;

create or replace function private.version_plan(p_version uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select plan_id from public.plan_versions where id = p_version $$;

create or replace function private.staff_pode_plano(p_plan uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_staff() and private.has_client_access(private.plan_client(p_plan)) $$;

-- Cliente com acesso à empresa e plano já enviado.
create or replace function private.cliente_ve_plano(p_plan uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.plans p
                 where p.id = p_plan and p.status <> 'rascunho'
                   and private.has_client_access(p.client_id))
$$;

create or replace function private.versao_atual_plano(p_plan uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select id from public.plan_versions where plan_id = p_plan order by numero desc limit 1 $$;

grant execute on function
  private.plan_client(uuid), private.version_plan(uuid), private.staff_pode_plano(uuid),
  private.cliente_ve_plano(uuid), private.versao_atual_plano(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------

-- Plano: status e datas só mudam pelo fluxo; o cliente do plano não muda.
create or replace function private.proteger_plano()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.enviado_em := null; new.visualizado_em := null; new.concluido_em := null;
    new.cancelado_em := null; new.motivo_cancelamento := null;
    new.titulo := btrim(new.titulo);
    return new;
  end if;
  if new.client_id <> old.client_id then
    raise exception 'O cliente do plano não pode ser trocado. Crie outro plano.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'O status muda só pelo fluxo de aprovação (enviar, decidir ou cancelar).'
      using errcode = '42501';
  end if;
  new.enviado_em := old.enviado_em; new.visualizado_em := old.visualizado_em;
  new.concluido_em := old.concluido_em; new.cancelado_em := old.cancelado_em;
  new.motivo_cancelamento := old.motivo_cancelamento;
  new.titulo := btrim(new.titulo);
  return new;
end;
$$;

-- Todo plano nasce com a versão 1 em rascunho.
create or replace function private.criar_primeira_versao_plano()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.transicao', 'on', true);
  insert into public.plan_versions (plan_id, numero) values (new.id, 1);
  perform set_config('app.transicao', '', true);
  return new;
end;
$$;

-- Versão: fora do fluxo, só a nota ao cliente do rascunho pode mudar.
create or replace function private.proteger_versao_plano()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Versão nova só pelo botão "Nova versão".' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Versão de plano não pode ser apagada.' using errcode = '42501';
  end if;
  -- Excluir do sistema quem criou a versão só limpa o autor (on delete set null).
  if old.created_by is not null and new.created_by is null
     and (to_jsonb(new) - 'created_by' - 'updated_at') = (to_jsonb(old) - 'created_by' - 'updated_at') then
    return new;
  end if;
  if old.status <> 'rascunho' then
    raise exception 'Versão já enviada ao cliente não pode ser alterada. Crie uma versão nova.'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'observacao' - 'updated_at') <> (to_jsonb(old) - 'observacao' - 'updated_at') then
    raise exception 'Só a nota da versão pode ser editada aqui.' using errcode = '42501';
  end if;
  new.observacao := nullif(btrim(coalesce(new.observacao, '')), '');
  return new;
end;
$$;

-- Seções e decisões só são gravadas pelas funções de fluxo.
create or replace function private.somente_pelo_fluxo()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'Use as funções do plano para alterar este registro.' using errcode = '42501';
end;
$$;

create trigger plans_protect before insert or update on public.plans
  for each row execute function private.proteger_plano();
create trigger plans_created_by before insert on public.plans
  for each row execute function private.stamp_created_by();
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();
create trigger plans_primeira_versao after insert on public.plans
  for each row execute function private.criar_primeira_versao_plano();
create trigger plans_audit after insert or update or delete on public.plans
  for each row execute function private.audit_row('plano', 'client_id');

create trigger plan_versions_protect before insert or update or delete on public.plan_versions
  for each row execute function private.proteger_versao_plano();
create trigger plan_versions_created_by before insert on public.plan_versions
  for each row execute function private.stamp_created_by();
create trigger plan_versions_updated_at before update on public.plan_versions
  for each row execute function private.set_updated_at();

create trigger plan_sections_protect before insert or update or delete on public.plan_sections
  for each row execute function private.somente_pelo_fluxo();

create trigger plan_decisions_immutable before update or delete on public.plan_section_decisions
  for each row execute function private.registro_imutavel();

-- Auditoria das tabelas filhas: o cliente vem do plano.
create or replace function private.audit_plano()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_plan uuid;
  v_actor uuid := private.actor_id();
  v_det jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  v_plan := coalesce(nullif(v_row ->> 'plan_id', '')::uuid,
                     private.version_plan(nullif(v_row ->> 'version_id', '')::uuid));
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(to_jsonb(new)) loop
      if v_key not in ('updated_at')
         and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key,
          jsonb_build_object('de', to_jsonb(old) -> v_key, 'para', to_jsonb(new) -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
    v_det := jsonb_build_object('alteracoes', v_changes, 'plan_id', v_plan);
  else
    v_det := jsonb_build_object('registro', v_row - 'created_at' - 'updated_at', 'plan_id', v_plan);
  end if;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, client_id, details)
  values (v_actor, (select p.email from public.profiles p where p.id = v_actor),
          tg_argv[0] || case tg_op when 'INSERT' then '.criado' when 'UPDATE' then '.alterado' else '.removido' end,
          tg_table_name, v_row ->> 'id', private.plan_client(v_plan), v_det);
  return coalesce(new, old);
end;
$$;

create trigger plan_versions_audit after insert or update on public.plan_versions
  for each row execute function private.audit_plano('plano.versao');
-- Seções não são auditadas linha a linha: o rascunho é regravado a cada
-- salvamento, e o que vale (o que foi enviado) fica na versão e nas decisões.
create trigger plan_decisions_audit after insert on public.plan_section_decisions
  for each row execute function private.audit_plano('plano.decisao');

-- ---------------------------------------------------------------------
-- Funções de fluxo (chamadas pelo site via RPC)
-- ---------------------------------------------------------------------

-- Confere se a versão atual do plano está em rascunho e devolve a versão.
create or replace function private.rascunho_do_plano(p_version uuid)
returns public.plan_versions
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.plan_versions%rowtype;
  v_p public.plans%rowtype;
begin
  select * into v_v from public.plan_versions where id = p_version for update;
  if not found or not private.staff_pode_plano(v_v.plan_id) then
    raise exception 'Plano não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  select * into v_p from public.plans where id = v_v.plan_id;
  if v_p.status = 'cancelado' then
    raise exception 'Plano cancelado não pode ser alterado.' using errcode = 'P0001';
  end if;
  if v_v.status <> 'rascunho' or v_v.id <> private.versao_atual_plano(v_v.plan_id) then
    raise exception 'Esta versão já foi enviada. Crie uma versão nova para mudar o plano.' using errcode = 'P0001';
  end if;
  return v_v;
end;
$$;

-- Registra o PDF da versão em rascunho (enviado antes ao Storage).
-- Caminho: {client_id}/{plan_id}/{arquivo}.pdf
create or replace function public.definir_pdf_plano(p_version uuid, p_path text, p_paginas integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.plan_versions;
  v_cli uuid;
begin
  v_v := private.rascunho_do_plano(p_version);
  v_cli := private.plan_client(v_v.plan_id);
  if p_path is null or p_path !~ ('^' || v_cli || '/' || v_v.plan_id || '/[A-Za-z0-9_-]+\.pdf$') then
    raise exception 'Caminho do PDF inválido.' using errcode = '22023';
  end if;
  if p_paginas is null or p_paginas < 1 or p_paginas > 500 then
    raise exception 'O PDF precisa ter entre 1 e 500 páginas.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'planos' and o.name = p_path) then
    raise exception 'O PDF ainda não foi enviado.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plan_versions set pdf_path = p_path, paginas = p_paginas where id = p_version;
  -- Seções que passam do fim do PDF novo são descartadas; a equipe revisa.
  delete from public.plan_sections where version_id = p_version and pagina_inicio > p_paginas;
  update public.plan_sections set pagina_fim = p_paginas where version_id = p_version and pagina_fim > p_paginas;
  perform set_config('app.transicao', '', true);
end;
$$;

-- Grava as seções da versão em rascunho, substituindo as anteriores.
-- p_secoes: [{nome, pagina_inicio, pagina_fim, requer_aprovacao, mantem_aprovacao_de}]
-- As seções precisam cobrir todas as páginas, em ordem e sem sobreposição.
create or replace function public.salvar_secoes_plano(p_version uuid, p_secoes jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.plan_versions;
  v_item jsonb;
  v_ordem integer := 0;
  v_prox integer := 1;
  v_ini integer; v_fim integer;
  v_nome text;
  v_requer boolean;
  v_mantem uuid;
  v_vistos uuid[] := '{}';
begin
  v_v := private.rascunho_do_plano(p_version);
  if v_v.paginas is null then
    raise exception 'Envie o PDF antes de marcar as seções.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_secoes) is distinct from 'array' or jsonb_array_length(p_secoes) = 0 then
    raise exception 'Marque pelo menos uma seção.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_secoes) > 100 then
    raise exception 'Use no máximo 100 seções.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  delete from public.plan_sections where version_id = p_version;

  for v_item in select value from jsonb_array_elements(p_secoes) loop
    v_ordem := v_ordem + 1;
    v_nome := btrim(coalesce(v_item ->> 'nome', ''));
    begin
      v_ini := (v_item ->> 'pagina_inicio')::integer;
      v_fim := (v_item ->> 'pagina_fim')::integer;
      v_requer := coalesce((v_item ->> 'requer_aprovacao')::boolean, true);
      v_mantem := nullif(v_item ->> 'mantem_aprovacao_de', '')::uuid;
    exception when others then
      raise exception 'Seção % com dados inválidos.', v_ordem using errcode = '22023';
    end;
    if length(v_nome) = 0 then
      raise exception 'Dê um nome à seção %.', v_ordem using errcode = 'P0001';
    end if;
    if v_ini is distinct from v_prox then
      raise exception 'A seção "%" deveria começar na página %.', v_nome, v_prox using errcode = 'P0001';
    end if;
    if v_fim is null or v_fim < v_ini or v_fim > v_v.paginas then
      raise exception 'A seção "%" termina numa página inválida.', v_nome using errcode = 'P0001';
    end if;
    if v_mantem is not null then
      if not v_requer then
        raise exception 'A seção "%" é informativa e não tem aprovação a manter.', v_nome using errcode = 'P0001';
      end if;
      -- Só vale aprovação de versão anterior do mesmo plano, uma vez por seção.
      if v_mantem = any (v_vistos) or not exists (
           select 1 from public.plan_sections s
           join public.plan_versions pv on pv.id = s.version_id
           where s.id = v_mantem and s.status = 'aprovada'
             and pv.plan_id = v_v.plan_id and pv.numero < v_v.numero) then
        raise exception 'A seção "%" não tem uma aprovação anterior válida para manter.', v_nome using errcode = 'P0001';
      end if;
      v_vistos := v_vistos || v_mantem;
    end if;
    insert into public.plan_sections (version_id, ordem, nome, pagina_inicio, pagina_fim, requer_aprovacao, mantem_aprovacao_de)
    values (p_version, v_ordem, v_nome, v_ini, v_fim, v_requer, v_mantem);
    v_prox := v_fim + 1;
  end loop;

  if v_prox <> v_v.paginas + 1 then
    raise exception 'As seções precisam ir até a última página (%).', v_v.paginas using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.enviar_plano(p_plan uuid)
returns public.plano_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.plans%rowtype;
  v_v public.plan_versions%rowtype;
  v_ultima integer;
begin
  select * into v_p from public.plans where id = p_plan for update;
  if not found or not private.staff_pode_plano(p_plan) then
    raise exception 'Plano não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_p.status = 'cancelado' then
    raise exception 'Plano cancelado não pode ser enviado.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clients c where c.id = v_p.client_id and c.ativo) then
    raise exception 'O cliente está inativo.' using errcode = 'P0001';
  end if;
  select * into v_v from public.plan_versions where id = private.versao_atual_plano(p_plan) for update;
  if v_v.status <> 'rascunho' then
    raise exception 'Esta versão já foi enviada. Crie uma versão nova para mudar o plano.' using errcode = 'P0001';
  end if;
  if v_v.pdf_path is null
     or not exists (select 1 from storage.objects o where o.bucket_id = 'planos' and o.name = v_v.pdf_path) then
    raise exception 'Envie o PDF do plano antes.' using errcode = 'P0001';
  end if;
  select max(pagina_fim) into v_ultima from public.plan_sections where version_id = v_v.id;
  if v_ultima is distinct from v_v.paginas then
    raise exception 'Marque as seções do plano até a última página.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plan_sections s
                 where s.version_id = v_v.id and s.requer_aprovacao and s.mantem_aprovacao_de is null) then
    raise exception 'Nenhuma seção desta versão precisa de aprovação. Desmarque "manter aprovação" das seções que mudaram.'
      using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.plan_sections s
     set status = case when not s.requer_aprovacao then 'informativa'::public.plano_secao_status
                       when s.mantem_aprovacao_de is not null then 'aprovada'::public.plano_secao_status
                       else 'pendente'::public.plano_secao_status end,
         decidido_em = case when s.mantem_aprovacao_de is not null
                            then (select o.decidido_em from public.plan_sections o where o.id = s.mantem_aprovacao_de) end
   where s.version_id = v_v.id;
  update public.plan_versions set status = 'pendente', enviado_em = now() where id = v_v.id;
  update public.plans
     set status = 'aguardando_aprovacao', enviado_em = now(), visualizado_em = null, concluido_em = null
   where id = p_plan;
  perform set_config('app.transicao', '', true);
  return 'aguardando_aprovacao';
end;
$$;

-- Nova versão: copia PDF e seções da atual para um rascunho novo. As seções
-- aprovadas já vêm marcadas para manter a aprovação; a equipe desmarca as que mudar.
-- Se a atual ainda aguardava o cliente, ela fica "substituída".
create or replace function public.nova_versao_plano(p_plan uuid, p_observacao text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.plans%rowtype;
  v_atual public.plan_versions%rowtype;
  v_nova uuid;
begin
  select * into v_p from public.plans where id = p_plan for update;
  if not found or not private.staff_pode_plano(p_plan) then
    raise exception 'Plano não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_p.status = 'cancelado' then
    raise exception 'Plano cancelado não pode ter versão nova.' using errcode = 'P0001';
  end if;
  select * into v_atual from public.plan_versions where id = private.versao_atual_plano(p_plan) for update;
  if v_atual.status = 'rascunho' then
    raise exception 'Já existe uma versão em rascunho. Edite essa versão.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  if v_atual.status = 'pendente' then
    update public.plan_versions set status = 'substituida' where id = v_atual.id;
  end if;
  insert into public.plan_versions (plan_id, numero, status, observacao, pdf_path, paginas)
  values (p_plan, v_atual.numero + 1, 'rascunho', nullif(btrim(coalesce(p_observacao, '')), ''),
          v_atual.pdf_path, v_atual.paginas)
  returning id into v_nova;
  insert into public.plan_sections (version_id, ordem, nome, pagina_inicio, pagina_fim, requer_aprovacao, mantem_aprovacao_de)
  select v_nova, s.ordem, s.nome, s.pagina_inicio, s.pagina_fim, s.requer_aprovacao,
         case when s.status = 'aprovada' then coalesce(s.mantem_aprovacao_de, s.id) end
    from public.plan_sections s where s.version_id = v_atual.id;
  update public.plans set status = 'em_revisao_interna', concluido_em = null where id = p_plan;
  perform set_config('app.transicao', '', true);
  return v_nova;
end;
$$;

create or replace function public.cancelar_plano(p_plan uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.staff_pode_plano(p_plan) then
    raise exception 'Plano não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plans
     set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   where id = p_plan and status <> 'cancelado';
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.registrar_visualizacao_plano(p_plan uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.cliente_ve_plano(p_plan) then
    return;
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plans
     set visualizado_em = now(), status = 'em_analise'
   where id = p_plan and status = 'aguardando_aprovacao';
  perform set_config('app.transicao', '', true);
end;
$$;

-- Decisão do cliente numa seção. Pode mudar de ideia enquanto houver seção
-- pendente; quando a última é decidida, a versão fecha: plano aprovado se
-- todas foram aprovadas, ou com ajustes solicitados.
create or replace function public.decidir_secao_plano(
  p_section uuid, p_decisao text, p_comentario text default null, p_slides integer[] default '{}')
returns public.plano_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_s public.plan_sections%rowtype;
  v_v public.plan_versions%rowtype;
  v_p public.plans%rowtype;
  v_eu public.profiles%rowtype;
  v_slides integer[];
  v_final public.plano_status;
begin
  select * into v_s from public.plan_sections where id = p_section;
  if not found then
    raise exception 'Seção não encontrada.' using errcode = '42501';
  end if;
  select * into v_v from public.plan_versions where id = v_s.version_id;
  select * into v_p from public.plans where id = v_v.plan_id for update;
  if not private.can_approve(v_p.client_id) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  if v_p.status not in ('aguardando_aprovacao', 'em_analise')
     or v_v.status <> 'pendente' or v_v.id <> private.versao_atual_plano(v_p.id) then
    raise exception 'Este plano não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  select * into v_s from public.plan_sections where id = p_section for update;
  if v_s.status not in ('pendente', 'aprovada', 'ajuste_solicitado') or v_s.mantem_aprovacao_de is not null then
    raise exception 'Esta seção não precisa de decisão.' using errcode = 'P0001';
  end if;
  if p_decisao not in ('aprovada', 'ajuste_solicitado') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if p_decisao = 'ajuste_solicitado' and length(btrim(coalesce(p_comentario, ''))) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_comentario, '')) > 4000 then
    raise exception 'Comentário muito longo (máximo 4.000 caracteres).' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_slides from unnest(coalesce(p_slides, '{}')) x;
  if exists (select 1 from unnest(v_slides) x where x < v_s.pagina_inicio or x > v_s.pagina_fim) then
    raise exception 'Os slides citados precisam ser desta seção (% a %).', v_s.pagina_inicio, v_s.pagina_fim
      using errcode = 'P0001';
  end if;

  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.plan_section_decisions (section_id, version_id, plan_id, client_id, secao_nome, decisao, comentario, slides,
                                             user_id, user_email, user_nome)
  values (v_s.id, v_v.id, v_p.id, v_p.client_id, v_s.nome, p_decisao, nullif(btrim(coalesce(p_comentario, '')), ''), v_slides,
          v_eu.id, v_eu.email, v_eu.nome);

  perform set_config('app.transicao', 'on', true);
  update public.plan_sections
     set status = p_decisao::public.plano_secao_status, decidido_em = now()
   where id = v_s.id;
  update public.plans set visualizado_em = coalesce(visualizado_em, now()), status = 'em_analise'
   where id = v_p.id and status = 'aguardando_aprovacao';

  if not exists (select 1 from public.plan_sections s where s.version_id = v_v.id and s.status = 'pendente') then
    v_final := case when exists (select 1 from public.plan_sections s
                                 where s.version_id = v_v.id and s.status = 'ajuste_solicitado')
                    then 'ajustes_solicitados' else 'aprovado' end;
    update public.plan_versions set status = 'concluida', decidido_em = now() where id = v_v.id;
    update public.plans set status = v_final, concluido_em = now() where id = v_p.id;
  else
    v_final := 'em_analise';
  end if;
  perform set_config('app.transicao', '', true);
  return v_final;
end;
$$;

revoke all on function public.definir_pdf_plano(uuid, text, integer), public.salvar_secoes_plano(uuid, jsonb),
  public.enviar_plano(uuid), public.nova_versao_plano(uuid, text), public.cancelar_plano(uuid, text),
  public.registrar_visualizacao_plano(uuid), public.decidir_secao_plano(uuid, text, text, integer[]),
  private.rascunho_do_plano(uuid)
from public, anon;
grant execute on function public.definir_pdf_plano(uuid, text, integer), public.salvar_secoes_plano(uuid, jsonb),
  public.enviar_plano(uuid), public.nova_versao_plano(uuid, text), public.cancelar_plano(uuid, text),
  public.registrar_visualizacao_plano(uuid), public.decidir_secao_plano(uuid, text, text, integer[]),
  private.rascunho_do_plano(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.plans                  enable row level security;
alter table public.plan_versions          enable row level security;
alter table public.plan_sections          enable row level security;
alter table public.plan_section_decisions enable row level security;

create policy plans_select on public.plans for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and private.has_client_access(client_id)));
create policy plans_insert on public.plans for insert to authenticated
  with check (private.is_staff() and private.has_client_access(client_id));
create policy plans_update on public.plans for update to authenticated
  using (private.is_staff() and private.has_client_access(client_id) and status <> 'cancelado')
  with check (private.is_staff() and private.has_client_access(client_id));

create policy plan_versions_select on public.plan_versions for select to authenticated
  using (private.staff_pode_plano(plan_id)
         or (status <> 'rascunho' and private.cliente_ve_plano(plan_id)));
create policy plan_versions_update on public.plan_versions for update to authenticated
  using (private.staff_pode_plano(plan_id)) with check (private.staff_pode_plano(plan_id));

create policy plan_sections_select on public.plan_sections for select to authenticated
  using (private.staff_pode_plano(private.version_plan(version_id))
         or (private.cliente_ve_plano(private.version_plan(version_id))
             and exists (select 1 from public.plan_versions v
                         where v.id = plan_sections.version_id and v.status <> 'rascunho')));

create policy plan_decisions_select on public.plan_section_decisions for select to authenticated
  using (private.has_client_access(client_id));

revoke all on public.plans, public.plan_versions, public.plan_sections, public.plan_section_decisions from anon;
revoke delete, truncate on public.plans from authenticated;
revoke insert, delete, truncate on public.plan_versions from authenticated;
revoke insert, update, delete, truncate on public.plan_sections, public.plan_section_decisions from authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privado com os PDFs. Caminho: {client_id}/{plan_id}/{arquivo}.pdf
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planos', 'planos', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Ler: equipe com acesso ao cliente; cliente só o PDF de versão já enviada.
create or replace function private.pode_ler_plano(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (private.is_staff() and private.has_client_access(
            case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end))
      or exists (select 1 from public.plan_versions v
                 where v.pdf_path = p_name and v.status <> 'rascunho'
                   and private.cliente_ve_plano(v.plan_id))
$$;

-- Enviar: equipe com acesso ao cliente, em plano desse cliente que não foi cancelado.
create or replace function private.pode_enviar_plano(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cli uuid; v_plan uuid;
begin
  begin
    v_cli := split_part(p_name, '/', 1)::uuid;
    v_plan := split_part(p_name, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  return private.is_staff() and private.has_client_access(v_cli)
     and exists (select 1 from public.plans p where p.id = v_plan and p.client_id = v_cli and p.status <> 'cancelado');
end;
$$;

-- Apagar: só arquivo que nenhuma versão usa.
create or replace function private.pode_apagar_plano(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.pode_enviar_plano(p_name)
     and not exists (select 1 from public.plan_versions v where v.pdf_path = p_name)
$$;

grant execute on function private.pode_ler_plano(text), private.pode_enviar_plano(text),
  private.pode_apagar_plano(text) to authenticated;

create policy planos_select on storage.objects for select to authenticated
  using (bucket_id = 'planos' and private.pode_ler_plano(name));
create policy planos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'planos' and private.pode_enviar_plano(name));
create policy planos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'planos' and private.pode_apagar_plano(name));
