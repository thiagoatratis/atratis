-- =====================================================================
-- Atratis Approval · Etapa 2 · Aprovação de criativos
-- Campanhas, solicitações, peças, versões, decisões do cliente,
-- comentários e arquivos privados no Storage.
--
-- Regras do fluxo:
--   * Mudança de status só acontece pelas funções enviar_solicitacao,
--     cancelar_solicitacao, registrar_visualizacao, decidir_versao e
--     aprovar_pendentes. Ninguém altera status direto na tabela.
--   * Cada peça tem versões. A decisão do cliente fica presa à versão.
--     Versão nova nasce "rascunho" e não herda aprovação nenhuma.
--   * O cliente nunca vê rascunho: só solicitações já enviadas e só
--     versões que já foram enviadas.
--   * Basta um aprovador da empresa decidir (decisão de 22/10/2026).
-- =====================================================================

create type public.solicitacao_status as enum (
  'rascunho', 'aguardando_aprovacao', 'em_analise', 'alteracoes_solicitadas',
  'em_revisao_interna', 'aprovado', 'cancelado');

create type public.versao_status as enum ('rascunho', 'pendente', 'aprovado', 'alteracoes_solicitadas');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  nome        text not null,
  objetivo    text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  constraint campaigns_nome_chk check (length(btrim(nome)) between 1 and 160)
);
create unique index campaigns_nome_uq on public.campaigns (client_id, lower(btrim(nome)));

create table public.creative_requests (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete restrict,
  campaign_id           uuid references public.campaigns (id) on delete set null,
  titulo                text not null,
  objetivo              text,
  veiculacao_inicio     date,
  veiculacao_fim        date,
  prazo_aprovacao       date,
  responsavel_id        uuid references public.profiles (id) on delete set null,
  instrucoes_cliente    text,
  status                public.solicitacao_status not null default 'rascunho',
  enviado_em            timestamptz,
  visualizado_em        timestamptz,
  concluido_em          timestamptz,
  cancelado_em          timestamptz,
  motivo_cancelamento   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null,
  constraint creative_requests_titulo_chk check (length(btrim(titulo)) between 1 and 200),
  constraint creative_requests_periodo_chk check (
    veiculacao_inicio is null or veiculacao_fim is null or veiculacao_fim >= veiculacao_inicio)
);
create index creative_requests_client_idx on public.creative_requests (client_id, status);
create index creative_requests_resp_idx on public.creative_requests (responsavel_id);

-- Observações internas da solicitação, invisíveis para o cliente.
create table public.creative_request_internal (
  request_id            uuid primary key references public.creative_requests (id) on delete cascade,
  observacoes_internas  text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles (id) on delete set null
);

create table public.creative_pieces (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.creative_requests (id) on delete cascade,
  nome        text not null,
  canal       text not null,
  formato     text not null,
  descricao   text,
  ordem       integer not null default 0,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  constraint creative_pieces_nome_chk check (length(btrim(nome)) between 1 and 160),
  constraint creative_pieces_canal_chk check (length(btrim(canal)) between 1 and 80),
  constraint creative_pieces_formato_chk check (length(btrim(formato)) between 1 and 80)
);
create index creative_pieces_request_idx on public.creative_pieces (request_id, ordem);

create table public.piece_versions (
  id                 uuid primary key default gen_random_uuid(),
  piece_id           uuid not null references public.creative_pieces (id) on delete cascade,
  numero             integer not null,
  parent_version_id  uuid references public.piece_versions (id) on delete set null,
  tipo               text not null,
  storage_path       text,
  nome_arquivo       text,
  mime_type          text,
  tamanho_bytes      bigint,
  link_url           text,
  observacao         text,
  status             public.versao_status not null default 'rascunho',
  enviado_em         timestamptz,
  decidido_em        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  constraint piece_versions_tipo_chk check (tipo in ('arquivo', 'link')),
  constraint piece_versions_conteudo_chk check (
    (tipo = 'arquivo' and storage_path is not null and link_url is null
       and mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'))
    or (tipo = 'link' and link_url ~* '^https?://' and storage_path is null)),
  constraint piece_versions_tamanho_chk check (tamanho_bytes is null or tamanho_bytes between 1 and 52428800),
  constraint piece_versions_numero_uq unique (piece_id, numero)
);
create unique index piece_versions_path_uq on public.piece_versions (storage_path) where storage_path is not null;

-- Decisões do cliente. Imutáveis: só a função decidir_versao grava.
create table public.approvals (
  id           bigint generated always as identity primary key,
  version_id   uuid not null references public.piece_versions (id) on delete restrict,
  piece_id     uuid not null references public.creative_pieces (id) on delete restrict,
  request_id   uuid not null references public.creative_requests (id) on delete restrict,
  client_id    uuid not null references public.clients (id) on delete restrict,
  decisao      text not null,
  comentario   text,
  user_id      uuid,
  user_email   text,
  user_nome    text,
  created_at   timestamptz not null default now(),
  constraint approvals_decisao_chk check (decisao in ('aprovado', 'alteracoes_solicitadas')),
  constraint approvals_comentario_chk check (
    decisao = 'aprovado' or length(btrim(coalesce(comentario, ''))) >= 3)
);
create index approvals_request_idx on public.approvals (request_id, created_at desc);

create table public.comments (
  id           bigint generated always as identity primary key,
  request_id   uuid not null references public.creative_requests (id) on delete cascade,
  piece_id     uuid references public.creative_pieces (id) on delete cascade,
  version_id   uuid references public.piece_versions (id) on delete set null,
  autor_id     uuid not null references public.profiles (id) on delete restrict,
  autor_nome   text,
  autor_papel  public.user_role,
  corpo        text not null,
  created_at   timestamptz not null default now(),
  constraint comments_corpo_chk check (length(btrim(corpo)) between 1 and 4000)
);
create index comments_request_idx on public.comments (request_id, created_at);

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

create or replace function private.request_client(p_request uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select client_id from public.creative_requests where id = p_request $$;

create or replace function private.piece_request(p_piece uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$ select request_id from public.creative_pieces where id = p_piece $$;

-- Equipe interna com acesso ao cliente da solicitação.
create or replace function private.staff_pode_request(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_staff() and private.has_client_access(private.request_client(p_request)) $$;

-- Cliente com acesso à empresa e solicitação já enviada.
create or replace function private.cliente_ve_request(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.creative_requests r
                 where r.id = p_request and r.status <> 'rascunho'
                   and private.has_client_access(r.client_id))
$$;

create or replace function private.request_editavel(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.creative_requests r where r.id = p_request and r.status <> 'cancelado') $$;

-- Versão atual (a de maior número) de cada peça ativa.
create or replace function private.versoes_atuais(p_request uuid)
returns table (piece_id uuid, version_id uuid, status public.versao_status)
language sql stable security definer set search_path = ''
as $$
  select distinct on (p.id) p.id, v.id, v.status
  from public.creative_pieces p
  join public.piece_versions v on v.piece_id = p.id
  where p.request_id = p_request and p.ativo
  order by p.id, v.numero desc
$$;

-- Status da solicitação a partir das versões atuais enviadas.
create or replace function private.status_calculado(p_request uuid)
returns public.solicitacao_status
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pend integer; v_alt integer; v_apr integer; v_total integer;
  v_r public.creative_requests%rowtype;
begin
  select * into v_r from public.creative_requests where id = p_request;
  select count(*) filter (where status = 'pendente'),
         count(*) filter (where status = 'alteracoes_solicitadas'),
         count(*) filter (where status = 'aprovado'),
         count(*)
    into v_pend, v_alt, v_apr, v_total
  from private.versoes_atuais(p_request) where status <> 'rascunho';

  if v_total = 0 then return v_r.status; end if;
  if v_pend > 0 then
    return case when v_r.visualizado_em is not null and v_r.visualizado_em >= v_r.enviado_em
                then 'em_analise'::public.solicitacao_status
                else 'aguardando_aprovacao'::public.solicitacao_status end;
  end if;
  if v_alt > 0 then return 'alteracoes_solicitadas'; end if;
  return 'aprovado';
end;
$$;

grant execute on function
  private.request_client(uuid), private.piece_request(uuid), private.staff_pode_request(uuid),
  private.cliente_ve_request(uuid), private.request_editavel(uuid), private.versoes_atuais(uuid),
  private.status_calculado(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------

-- Status só muda dentro das funções de transição (que ligam app.transicao).
create or replace function private.bloquear_status_direto()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_fluxo boolean := coalesce(current_setting('app.transicao', true), '') = 'on';
begin
  if v_fluxo then
    return new;
  end if;
  -- Fora do fluxo: status e datas do fluxo não podem ser definidos à mão.
  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.enviado_em := null;
    if tg_table_name = 'creative_requests' then
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
  if tg_table_name = 'creative_requests' then
    new.visualizado_em := old.visualizado_em; new.concluido_em := old.concluido_em;
    new.cancelado_em := old.cancelado_em; new.motivo_cancelamento := old.motivo_cancelamento;
  else
    new.decidido_em := old.decidido_em;
  end if;
  return new;
end;
$$;

-- Versão nova: numeração automática, liga à anterior e reabre a solicitação.
create or replace function private.preparar_versao()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ult public.piece_versions%rowtype;
  v_req uuid := private.piece_request(new.piece_id);
  v_antes text;
begin
  select * into v_ult from public.piece_versions
   where piece_id = new.piece_id order by numero desc limit 1;
  if found and v_ult.status = 'rascunho' then
    raise exception 'Esta peça já tem uma versão em rascunho. Edite essa versão em vez de criar outra.'
      using errcode = 'P0001';
  end if;
  new.numero := coalesce(v_ult.numero, 0) + 1;
  new.parent_version_id := v_ult.id;

  v_antes := coalesce(current_setting('app.transicao', true), '');
  perform set_config('app.transicao', 'on', true);
  update public.creative_requests
     set status = 'em_revisao_interna'
   where id = v_req and status in ('aprovado', 'alteracoes_solicitadas');
  perform set_config('app.transicao', v_antes, true);
  return new;
end;
$$;

-- Versão já enviada não muda mais (o histórico é a prova da aprovação).
create or replace function private.proteger_versao()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if old.status <> 'rascunho' then
    raise exception 'Versão já enviada ao cliente não pode ser alterada nem apagada. Crie uma versão nova.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.piece_id <> old.piece_id or new.numero <> old.numero) then
    raise exception 'Não é possível mover a versão para outra peça.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Peça que já foi ao cliente não pode ser apagada (só retirada).
create or replace function private.proteger_peca()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from public.piece_versions v where v.piece_id = old.id and v.status <> 'rascunho') then
    raise exception 'Esta peça já foi enviada ao cliente. Use "Retirar peça" em vez de apagar.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

-- Comentário: autor é sempre quem está logado.
create or replace function private.preparar_comentario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.profiles%rowtype;
begin
  select * into v_p from public.profiles where id = auth.uid();
  new.autor_id := auth.uid();
  new.autor_nome := coalesce(v_p.nome, v_p.email);
  new.autor_papel := v_p.role;
  new.created_at := now();
  if new.piece_id is not null and private.piece_request(new.piece_id) <> new.request_id then
    raise exception 'Peça não pertence a esta solicitação.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger campaigns_created_by before insert on public.campaigns
  for each row execute function private.stamp_created_by();
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();
create trigger campaigns_audit after insert or update or delete on public.campaigns
  for each row execute function private.audit_row('campanha', 'client_id');

create trigger creative_requests_status before insert or update on public.creative_requests
  for each row execute function private.bloquear_status_direto();
create trigger creative_requests_created_by before insert on public.creative_requests
  for each row execute function private.stamp_created_by();
create trigger creative_requests_updated_at before update on public.creative_requests
  for each row execute function private.set_updated_at();
create trigger creative_requests_audit after insert or update or delete on public.creative_requests
  for each row execute function private.audit_row('solicitacao', 'client_id');

create trigger creative_request_internal_by before insert or update on public.creative_request_internal
  for each row execute function private.stamp_updated_by();
create trigger creative_request_internal_at before update on public.creative_request_internal
  for each row execute function private.set_updated_at();

create trigger creative_pieces_created_by before insert on public.creative_pieces
  for each row execute function private.stamp_created_by();
create trigger creative_pieces_updated_at before update on public.creative_pieces
  for each row execute function private.set_updated_at();
create trigger creative_pieces_protect before delete on public.creative_pieces
  for each row execute function private.proteger_peca();

create trigger piece_versions_status before insert or update on public.piece_versions
  for each row execute function private.bloquear_status_direto();
create trigger piece_versions_prepare before insert on public.piece_versions
  for each row execute function private.preparar_versao();
create trigger piece_versions_protect before update or delete on public.piece_versions
  for each row execute function private.proteger_versao();
create trigger piece_versions_created_by before insert on public.piece_versions
  for each row execute function private.stamp_created_by();
create trigger piece_versions_updated_at before update on public.piece_versions
  for each row execute function private.set_updated_at();

create trigger comments_prepare before insert on public.comments
  for each row execute function private.preparar_comentario();

-- Auditoria das tabelas filhas: o client_id vem da solicitação.
create or replace function private.audit_criativo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_req uuid;
  v_actor uuid := private.actor_id();
  v_acao text;
  v_det jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  v_req := coalesce(nullif(v_row ->> 'request_id', '')::uuid,
                    private.piece_request(nullif(v_row ->> 'piece_id', '')::uuid));
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(to_jsonb(new)) loop
      if v_key not in ('updated_at', 'updated_by')
         and (to_jsonb(new) -> v_key) is distinct from (to_jsonb(old) -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key,
          jsonb_build_object('de', to_jsonb(old) -> v_key, 'para', to_jsonb(new) -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
    v_det := jsonb_build_object('alteracoes', v_changes, 'request_id', v_req);
  else
    v_det := jsonb_build_object('registro', v_row - 'created_at' - 'updated_at', 'request_id', v_req);
  end if;
  v_acao := tg_argv[0] || case tg_op when 'INSERT' then '.criado' when 'UPDATE' then '.alterado' else '.removido' end;

  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, client_id, details)
  values (v_actor, (select p.email from public.profiles p where p.id = v_actor), v_acao, tg_table_name,
          v_row ->> 'id', private.request_client(v_req), v_det);
  return coalesce(new, old);
end;
$$;

create trigger creative_request_internal_audit after insert or update on public.creative_request_internal
  for each row execute function private.audit_criativo('solicitacao.observacoes');
create trigger creative_pieces_audit after insert or update or delete on public.creative_pieces
  for each row execute function private.audit_criativo('peca');
create trigger piece_versions_audit after insert or update or delete on public.piece_versions
  for each row execute function private.audit_criativo('versao');
create trigger approvals_audit after insert on public.approvals
  for each row execute function private.audit_criativo('decisao');
create trigger comments_audit after insert on public.comments
  for each row execute function private.audit_criativo('comentario');

create or replace function private.registro_imutavel()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Este registro faz parte do histórico e não pode ser alterado nem apagado.'
    using errcode = '42501';
end;
$$;
create trigger approvals_immutable before update or delete on public.approvals
  for each row execute function private.registro_imutavel();
create trigger comments_immutable before update on public.comments
  for each row execute function private.registro_imutavel();

-- ---------------------------------------------------------------------
-- Funções de fluxo (chamadas pelo site via RPC)
-- ---------------------------------------------------------------------

create or replace function public.enviar_solicitacao(p_request uuid)
returns public.solicitacao_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_r public.creative_requests%rowtype;
  v_rasc integer;
  v_pendencia text;
  v_novo public.solicitacao_status;
begin
  select * into v_r from public.creative_requests where id = p_request for update;
  if not found or not private.staff_pode_request(p_request) then
    raise exception 'Solicitação não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  if v_r.status = 'cancelado' then
    raise exception 'Solicitação cancelada não pode ser enviada.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clients c where c.id = v_r.client_id and c.ativo) then
    raise exception 'O cliente está inativo.' using errcode = 'P0001';
  end if;

  select p.nome into v_pendencia
  from private.versoes_atuais(p_request) va join public.creative_pieces p on p.id = va.piece_id
  where va.status = 'alteracoes_solicitadas' limit 1;
  if v_pendencia is not null then
    raise exception 'A peça "%" está com alterações pedidas. Envie uma versão nova ou retire a peça antes de reenviar.', v_pendencia
      using errcode = 'P0001';
  end if;

  select count(*) into v_rasc from private.versoes_atuais(p_request) where status = 'rascunho';
  if v_rasc = 0 then
    raise exception 'Não há peça nova ou versão nova para enviar.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.piece_versions v set status = 'pendente', enviado_em = now()
   where v.id in (select version_id from private.versoes_atuais(p_request) where status = 'rascunho');
  update public.creative_requests set enviado_em = now(), visualizado_em = null, concluido_em = null
   where id = p_request;
  v_novo := private.status_calculado(p_request);
  update public.creative_requests set status = v_novo where id = p_request;
  perform set_config('app.transicao', '', true);
  return v_novo;
end;
$$;

create or replace function public.cancelar_solicitacao(p_request uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.staff_pode_request(p_request) then
    raise exception 'Solicitação não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.creative_requests
     set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   where id = p_request and status <> 'cancelado';
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.registrar_visualizacao(p_request uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.cliente_ve_request(p_request) then
    return;
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.creative_requests
     set visualizado_em = now(), status = 'em_analise'
   where id = p_request and status = 'aguardando_aprovacao';
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.decidir_versao(p_version uuid, p_decisao text, p_comentario text default null)
returns public.solicitacao_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.piece_versions%rowtype;
  v_p public.creative_pieces%rowtype;
  v_r public.creative_requests%rowtype;
  v_eu public.profiles%rowtype;
  v_novo public.solicitacao_status;
begin
  select * into v_v from public.piece_versions where id = p_version for update;
  if not found then raise exception 'Versão não encontrada.' using errcode = '42501'; end if;
  select * into v_p from public.creative_pieces where id = v_v.piece_id;
  select * into v_r from public.creative_requests where id = v_p.request_id for update;

  if not private.can_approve(v_r.client_id) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  if v_r.status not in ('aguardando_aprovacao', 'em_analise') then
    raise exception 'Esta solicitação não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  if v_v.status <> 'pendente' or not v_p.ativo then
    raise exception 'Esta peça não está aguardando decisão.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.versoes_atuais(v_r.id) va where va.version_id = v_v.id) then
    raise exception 'Existe uma versão mais nova desta peça.' using errcode = 'P0001';
  end if;
  if p_decisao not in ('aprovado', 'alteracoes_solicitadas') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if p_decisao = 'alteracoes_solicitadas' and length(btrim(coalesce(p_comentario, ''))) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.' using errcode = 'P0001';
  end if;

  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.approvals (version_id, piece_id, request_id, client_id, decisao, comentario, user_id, user_email, user_nome)
  values (v_v.id, v_p.id, v_r.id, v_r.client_id, p_decisao, nullif(btrim(coalesce(p_comentario, '')), ''),
          v_eu.id, v_eu.email, v_eu.nome);

  perform set_config('app.transicao', 'on', true);
  update public.piece_versions set status = p_decisao::public.versao_status, decidido_em = now() where id = v_v.id;
  update public.creative_requests set visualizado_em = coalesce(visualizado_em, now()) where id = v_r.id;
  v_novo := private.status_calculado(v_r.id);
  update public.creative_requests
     set status = v_novo,
         concluido_em = case when v_novo in ('aprovado', 'alteracoes_solicitadas') then now() else null end
   where id = v_r.id;
  perform set_config('app.transicao', '', true);
  return v_novo;
end;
$$;

create or replace function public.aprovar_pendentes(p_request uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  if not private.can_approve(private.request_client(p_request)) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  for v_id in select version_id from private.versoes_atuais(p_request) where status = 'pendente' loop
    perform public.decidir_versao(v_id, 'aprovado', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Retirar peça (fica no histórico, sai da aprovação).
create or replace function public.retirar_peca(p_piece uuid)
returns public.solicitacao_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_req uuid := private.piece_request(p_piece);
  v_novo public.solicitacao_status;
begin
  if v_req is null or not private.staff_pode_request(v_req) then
    raise exception 'Peça não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  update public.creative_pieces set ativo = false where id = p_piece;
  perform set_config('app.transicao', 'on', true);
  if exists (select 1 from public.creative_requests where id = v_req and status not in ('rascunho', 'cancelado')) then
    v_novo := private.status_calculado(v_req);
    update public.creative_requests set status = v_novo where id = v_req;
  end if;
  perform set_config('app.transicao', '', true);
  return v_novo;
end;
$$;

revoke all on function public.enviar_solicitacao(uuid), public.cancelar_solicitacao(uuid, text),
  public.registrar_visualizacao(uuid), public.decidir_versao(uuid, text, text),
  public.aprovar_pendentes(uuid), public.retirar_peca(uuid) from public, anon;
grant execute on function public.enviar_solicitacao(uuid), public.cancelar_solicitacao(uuid, text),
  public.registrar_visualizacao(uuid), public.decidir_versao(uuid, text, text),
  public.aprovar_pendentes(uuid), public.retirar_peca(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

alter table public.campaigns                 enable row level security;
alter table public.creative_requests         enable row level security;
alter table public.creative_request_internal enable row level security;
alter table public.creative_pieces           enable row level security;
alter table public.piece_versions            enable row level security;
alter table public.approvals                 enable row level security;
alter table public.comments                  enable row level security;

create policy campaigns_select on public.campaigns for select to authenticated
  using (private.has_client_access(client_id));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (private.is_staff() and private.has_client_access(client_id));
create policy campaigns_update on public.campaigns for update to authenticated
  using (private.is_staff() and private.has_client_access(client_id))
  with check (private.is_staff() and private.has_client_access(client_id));

create policy requests_select on public.creative_requests for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and private.has_client_access(client_id)));
create policy requests_insert on public.creative_requests for insert to authenticated
  with check (private.is_staff() and private.has_client_access(client_id));
create policy requests_update on public.creative_requests for update to authenticated
  using (private.is_staff() and private.has_client_access(client_id) and status <> 'cancelado')
  with check (private.is_staff() and private.has_client_access(client_id));

create policy request_internal_all on public.creative_request_internal for select to authenticated
  using (private.staff_pode_request(request_id));
create policy request_internal_insert on public.creative_request_internal for insert to authenticated
  with check (private.staff_pode_request(request_id));
create policy request_internal_update on public.creative_request_internal for update to authenticated
  using (private.staff_pode_request(request_id)) with check (private.staff_pode_request(request_id));

create policy pieces_select on public.creative_pieces for select to authenticated
  using (private.staff_pode_request(request_id)
         or (private.cliente_ve_request(request_id)
             and exists (select 1 from public.piece_versions v
                         where v.piece_id = creative_pieces.id and v.status <> 'rascunho')));
create policy pieces_insert on public.creative_pieces for insert to authenticated
  with check (private.staff_pode_request(request_id) and private.request_editavel(request_id));
create policy pieces_update on public.creative_pieces for update to authenticated
  using (private.staff_pode_request(request_id) and private.request_editavel(request_id))
  with check (private.staff_pode_request(request_id));
create policy pieces_delete on public.creative_pieces for delete to authenticated
  using (private.staff_pode_request(request_id) and private.request_editavel(request_id));

create policy versions_select on public.piece_versions for select to authenticated
  using (private.staff_pode_request(private.piece_request(piece_id))
         or (status <> 'rascunho' and private.cliente_ve_request(private.piece_request(piece_id))));
create policy versions_insert on public.piece_versions for insert to authenticated
  with check (private.staff_pode_request(private.piece_request(piece_id))
              and private.request_editavel(private.piece_request(piece_id)));
create policy versions_update on public.piece_versions for update to authenticated
  using (private.staff_pode_request(private.piece_request(piece_id)))
  with check (private.staff_pode_request(private.piece_request(piece_id)));
create policy versions_delete on public.piece_versions for delete to authenticated
  using (private.staff_pode_request(private.piece_request(piece_id)));

create policy approvals_select on public.approvals for select to authenticated
  using (private.has_client_access(client_id));

create policy comments_select on public.comments for select to authenticated
  using (private.staff_pode_request(request_id) or private.cliente_ve_request(request_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (private.request_editavel(request_id)
              and (private.staff_pode_request(request_id) or private.cliente_ve_request(request_id)));

revoke all on public.campaigns, public.creative_requests, public.creative_request_internal,
  public.creative_pieces, public.piece_versions, public.approvals, public.comments from anon;
revoke delete, truncate on public.campaigns, public.creative_requests, public.creative_request_internal from authenticated;
revoke insert, update, delete, truncate on public.approvals from authenticated;
revoke update, delete, truncate on public.comments from authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privado para os arquivos das peças
-- Caminho: {client_id}/{request_id}/{piece_id}/{arquivo}
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('criativos', 'criativos', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Quem pode ler um arquivo: equipe do cliente; ou cliente, se a versão já foi enviada.
create or replace function private.pode_ler_arquivo(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.piece_versions v
    where v.storage_path = p_name
      and (private.staff_pode_request(private.piece_request(v.piece_id))
           or (v.status <> 'rascunho' and private.cliente_ve_request(private.piece_request(v.piece_id)))))
  or (private.is_staff() and private.has_client_access(nullif(split_part(p_name, '/', 1), '')::uuid))
$$;

-- Quem pode enviar: equipe com acesso ao cliente e solicitação desse cliente.
create or replace function private.pode_enviar_arquivo(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cli uuid; v_req uuid;
begin
  begin
    v_cli := split_part(p_name, '/', 1)::uuid;
    v_req := split_part(p_name, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  return private.is_staff() and private.has_client_access(v_cli)
     and private.request_client(v_req) = v_cli and private.request_editavel(v_req);
end;
$$;

-- Apagar: só arquivo que nenhuma versão enviada usa.
create or replace function private.pode_apagar_arquivo(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.pode_enviar_arquivo(p_name)
     and not exists (select 1 from public.piece_versions v where v.storage_path = p_name and v.status <> 'rascunho')
$$;

grant execute on function private.pode_ler_arquivo(text), private.pode_enviar_arquivo(text),
  private.pode_apagar_arquivo(text) to authenticated;

create policy criativos_select on storage.objects for select to authenticated
  using (bucket_id = 'criativos' and private.pode_ler_arquivo(name));
create policy criativos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'criativos' and private.pode_enviar_arquivo(name));
create policy criativos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'criativos' and private.pode_apagar_arquivo(name));
