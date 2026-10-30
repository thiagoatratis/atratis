-- =====================================================================
-- Atratis Approval · Blocos de boleto no orçamento
--
-- Decisões de 29/10/2026:
--   * Um orçamento pode ter vários blocos (ex.: "Geral" e "Revista"), cada
--     um com sua tabela, subtotal e P.I.s próprios (boletos separados).
--     Toda linha pertence a um bloco; sem informar, vai para "Geral".
--   * O cliente aprova (ou pede ajuste) bloco por bloco. Bloco aprovado já
--     libera os próprios P.I.s, sem esperar os outros.
--   * Na geração de P.I., a equipe escolhe um bloco ou todos (só os
--     aprovados) e se é consolidado ou um por canal. Os blocos nunca se
--     misturam. A observação de cada P.I. traz os nomes dos projetos.
--   * Nova versão: bloco sem nenhuma mudança continua aprovado; só os
--     blocos alterados voltam para o cliente.
--   * A aprovação em reunião pode marcar todos os blocos ou só alguns.
-- =====================================================================

alter table public.budget_lines
  add column bloco text not null default 'Geral',
  add constraint budget_lines_bloco_chk check (length(btrim(bloco)) between 1 and 60);

alter table public.budget_changes
  add column bloco text,
  add column bloco_antes text;

-- Decisões: bloco decidido (vazio nas decisões de antes dos blocos = orçamento inteiro).
alter table public.budget_approvals add column bloco text;

-- P.I.: bloco de onde saiu.
alter table public.insertion_orders add column bloco text;

-- ---------------------------------------------------------------------
-- Situação de cada bloco em cada versão (gravada só pelas funções do fluxo)
-- ---------------------------------------------------------------------

create table public.budget_blocks (
  version_id   uuid not null references public.budget_versions (id) on delete cascade,
  budget_id    uuid not null references public.budgets (id) on delete cascade,
  bloco        text not null,
  status       public.orcamento_versao_status not null default 'rascunho',
  enviado_em   timestamptz,
  decidido_em  timestamptz,
  primary key (version_id, bloco)
);
create index budget_blocks_budget_idx on public.budget_blocks (budget_id);

alter table public.budget_blocks enable row level security;
create policy budget_blocks_select on public.budget_blocks for select to authenticated
  using (private.staff_pode_orcamento(budget_id)
         or (status <> 'rascunho' and private.cliente_ve_orcamento(budget_id)));
revoke all on public.budget_blocks from anon;
revoke insert, update, delete, truncate on public.budget_blocks from authenticated;

-- Orçamentos que já existem: tudo no bloco "Geral", com a situação da versão.
insert into public.budget_blocks (version_id, budget_id, bloco, status, enviado_em, decidido_em)
select distinct v.id, v.budget_id, l.bloco, v.status, v.enviado_em, v.decidido_em
  from public.budget_versions v
  join public.budget_lines l on l.version_id = v.id
on conflict do nothing;

-- (Decisões antigas ficam com bloco vazio: valem para o orçamento inteiro.
-- A tabela de decisões é imutável, então elas não são reescritas.)

-- ---------------------------------------------------------------------
-- Sincroniza os blocos com as linhas e recalcula a situação da versão e do
-- orçamento a partir dos blocos (pendente > ajuste pedido > aprovado).
-- ---------------------------------------------------------------------

create or replace function private.recalcular_orcamento(p_version uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.budget_versions%rowtype;
  v_b public.budgets%rowtype;
  v_pend integer;
  v_alt integer;
  v_novo_v public.orcamento_versao_status;
  v_novo_b public.orcamento_status;
  v_transicao text := coalesce(current_setting('app.transicao', true), '');
begin
  select * into v_v from public.budget_versions where id = p_version;
  if not found then
    return;
  end if;
  select * into v_b from public.budgets where id = v_v.budget_id;

  delete from public.budget_blocks k
   where k.version_id = p_version
     and not exists (select 1 from public.budget_lines l where l.version_id = p_version and l.bloco = k.bloco);
  insert into public.budget_blocks (version_id, budget_id, bloco, status, enviado_em)
  select distinct p_version, v_v.budget_id, l.bloco,
         case when v_v.status = 'rascunho' then 'rascunho' else 'pendente' end::public.orcamento_versao_status,
         case when v_v.status = 'rascunho' then null else now() end
    from public.budget_lines l
   where l.version_id = p_version
  on conflict do nothing;

  if v_v.status in ('rascunho', 'substituida') or v_b.status = 'cancelado'
     or v_v.id <> private.versao_atual_orcamento(v_v.budget_id) then
    return;
  end if;

  select count(*) filter (where status = 'pendente'), count(*) filter (where status = 'alteracoes_solicitadas')
    into v_pend, v_alt
    from public.budget_blocks where version_id = p_version;
  v_novo_v := case when v_pend > 0 then 'pendente' when v_alt > 0 then 'alteracoes_solicitadas' else 'aprovado' end;
  v_novo_b := case v_novo_v
                when 'pendente' then case when v_b.status = 'em_analise' then 'em_analise' else 'aguardando_aprovacao' end
                when 'alteracoes_solicitadas' then 'alteracoes_solicitadas'
                else 'aprovado' end;

  perform set_config('app.transicao', 'on', true);
  if v_novo_v is distinct from v_v.status then
    update public.budget_versions
       set status = v_novo_v,
           decidido_em = case when v_novo_v = 'pendente' then null else now() end
     where id = p_version;
  end if;
  if v_novo_b is distinct from v_b.status then
    update public.budgets
       set status = v_novo_b,
           concluido_em = case when v_novo_b in ('aprovado', 'alteracoes_solicitadas') then now() else null end
     where id = v_b.id;
  end if;
  perform set_config('app.transicao', v_transicao, true);
end;
$$;

create or replace function private.blocos_da_linha()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.recalcular_orcamento(coalesce(new.version_id, old.version_id));
  return null;
end;
$$;

create trigger budget_lines_blocos after insert or update or delete on public.budget_lines
  for each row execute function private.blocos_da_linha();

-- Total de um bloco na versão.
create or replace function private.total_bloco(p_version uuid, p_bloco text)
returns numeric
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(valor), 0)::numeric(14, 2) from public.budget_lines where version_id = p_version and bloco = p_bloco $$;

-- Bloco igual (mesmas linhas, sem contar a ordem) nas duas versões.
create or replace function private.bloco_igual(p_nova uuid, p_anterior uuid, p_bloco text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
           (select projeto, plataforma, descricao, valor from public.budget_lines where version_id = p_nova and bloco = p_bloco)
           except all
           (select projeto, plataforma, descricao, valor from public.budget_lines where version_id = p_anterior and bloco = p_bloco))
     and not exists (
           (select projeto, plataforma, descricao, valor from public.budget_lines where version_id = p_anterior and bloco = p_bloco)
           except all
           (select projeto, plataforma, descricao, valor from public.budget_lines where version_id = p_nova and bloco = p_bloco))
$$;

-- ---------------------------------------------------------------------
-- Linhas: bloco limpo (vazio vira "Geral"); histórico com o bloco.
-- ---------------------------------------------------------------------

create or replace function private.preparar_linha_orcamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.budget_versions%rowtype;
  v_b public.budgets%rowtype;
begin
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'Não é possível mover a linha para outra versão.' using errcode = '42501';
  end if;
  -- Trava a versão: mudanças de linha ficam em fila com a decisão do cliente
  -- (decidir_orcamento trava a mesma linha) e com outras exclusões.
  select * into v_v from public.budget_versions where id = coalesce(new.version_id, old.version_id) for update;
  select * into v_b from public.budgets where id = v_v.budget_id;
  if v_b.status = 'cancelado' then
    raise exception 'Orçamento cancelado não pode ser alterado.' using errcode = '42501';
  end if;
  if v_v.status = 'substituida' or v_v.id <> private.versao_atual_orcamento(v_v.budget_id) then
    raise exception 'Esta versão foi substituída. Altere a versão atual do orçamento.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if v_v.status <> 'rascunho'
       and (select count(*) from public.budget_lines l where l.version_id = v_v.id) <= 1 then
      raise exception 'O orçamento enviado precisa de pelo menos uma linha.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.plataforma := btrim(new.plataforma);
  new.descricao := nullif(btrim(coalesce(new.descricao, '')), '');
  new.projeto := nullif(btrim(regexp_replace(coalesce(new.projeto, ''), '\s+', ' ', 'g')), '');
  new.bloco := coalesce(nullif(btrim(regexp_replace(coalesce(new.bloco, ''), '\s+', ' ', 'g')), ''), 'Geral');
  new.aliquota := private.aliquota_plataforma(new.plataforma);
  return new;
end;
$$;

create or replace function private.registrar_alteracao_orcamento()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.budget_versions%rowtype;
  v_b public.budgets%rowtype;
  v_actor uuid := private.actor_id();
  v_eu public.profiles%rowtype;
  v_acao text;
  v_status public.orcamento_status;
begin
  select * into v_v from public.budget_versions where id = coalesce(new.version_id, old.version_id);
  if v_v.status = 'rascunho' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.valor = old.valor and new.plataforma = old.plataforma
     and new.descricao is not distinct from old.descricao and new.projeto is not distinct from old.projeto
     and new.bloco = old.bloco then
    return new;  -- só mudou a ordem
  end if;
  select * into v_b from public.budgets where id = v_v.budget_id;
  -- "Depois da aprovação" quando o bloco da linha (antes da mudança) já estava aprovado.
  select case when k.status = 'aprovado' then 'aprovado'::public.orcamento_status else v_b.status end
    into v_status
    from public.budget_blocks k
   where k.version_id = v_v.id and k.bloco = coalesce(old.bloco, new.bloco);
  select * into v_eu from public.profiles where id = v_actor;
  v_acao := case tg_op when 'INSERT' then 'incluida' when 'UPDATE' then 'alterada' else 'removida' end;
  insert into public.budget_changes (budget_id, version_id, client_id, acao, plataforma, descricao, projeto, bloco,
                                     plataforma_antes, descricao_antes, projeto_antes, bloco_antes, valor_antes, valor_depois,
                                     status_orcamento, user_id, user_email, user_nome)
  values (v_b.id, v_v.id, v_b.client_id, v_acao,
          coalesce(new.plataforma, old.plataforma),
          case when tg_op = 'DELETE' then old.descricao else new.descricao end,
          case when tg_op = 'DELETE' then old.projeto else new.projeto end,
          case when tg_op = 'DELETE' then old.bloco else new.bloco end,
          case when tg_op = 'UPDATE' then old.plataforma end, case when tg_op = 'UPDATE' then old.descricao end,
          case when tg_op = 'UPDATE' then old.projeto end, case when tg_op = 'UPDATE' then old.bloco end,
          case when tg_op <> 'INSERT' then old.valor end, case when tg_op <> 'DELETE' then new.valor end,
          coalesce(v_status, v_b.status), v_eu.id, v_eu.email, v_eu.nome);
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- Envio: rascunho vai inteiro (bloco igual a um já aprovado na versão
-- anterior continua aprovado); depois, reenvia os blocos com ajuste pedido.
-- ---------------------------------------------------------------------

create or replace function public.enviar_orcamento(p_budget uuid)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao public.budget_versions%rowtype;
  v_anterior public.budget_versions%rowtype;
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
  if not exists (select 1 from public.budget_lines l where l.version_id = v_versao.id) then
    raise exception 'Adicione pelo menos uma linha antes de enviar.' using errcode = 'P0001';
  end if;
  if v_versao.status <> 'rascunho' and not exists (
       select 1 from public.budget_blocks k where k.version_id = v_versao.id and k.status = 'alteracoes_solicitadas') then
    raise exception 'Este orçamento já está com o cliente. As mudanças nos valores aparecem para ele na hora.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  if v_versao.status = 'rascunho' then
    select * into v_anterior from public.budget_versions
     where budget_id = p_budget and numero < v_versao.numero and status <> 'rascunho'
     order by numero desc limit 1;
    update public.budget_blocks k
       set status = case when v_anterior.id is not null and exists (
                           select 1 from public.budget_blocks a
                            where a.version_id = v_anterior.id and a.bloco = k.bloco and a.status = 'aprovado')
                         and private.bloco_igual(v_versao.id, v_anterior.id, k.bloco)
                         then 'aprovado' else 'pendente' end::public.orcamento_versao_status,
           enviado_em = now(),
           decidido_em = (select a.decidido_em from public.budget_blocks a
                           where a.version_id = v_anterior.id and a.bloco = k.bloco and a.status = 'aprovado'
                             and private.bloco_igual(v_versao.id, v_anterior.id, k.bloco))
     where k.version_id = v_versao.id;
  else
    update public.budget_blocks
       set status = 'pendente', enviado_em = now(), decidido_em = null
     where version_id = v_versao.id and status = 'alteracoes_solicitadas';
  end if;
  update public.budget_versions set status = 'pendente', enviado_em = now(), decidido_em = null where id = v_versao.id;
  update public.budgets
     set status = 'aguardando_aprovacao', enviado_em = now(), visualizado_em = null, concluido_em = null
   where id = p_budget;
  perform private.recalcular_orcamento(v_versao.id);
  perform set_config('app.transicao', '', true);
  return (select status from public.budgets where id = p_budget);
end;
$$;

-- ---------------------------------------------------------------------
-- Decisão do cliente por bloco
-- ---------------------------------------------------------------------

-- Grava a decisão de um bloco pendente (sem checar permissão: quem chama checa).
create or replace function private.decidir_bloco(p_budget uuid, p_version uuid, p_bloco text, p_decisao text, p_comentario text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_eu public.profiles%rowtype;
begin
  select * into v_b from public.budgets where id = p_budget;
  select * into v_eu from public.profiles where id = auth.uid();
  insert into public.budget_approvals (version_id, budget_id, client_id, decisao, comentario, total, bloco,
                                       user_id, user_email, user_nome)
  values (p_version, v_b.id, v_b.client_id, p_decisao, nullif(btrim(coalesce(p_comentario, '')), ''),
          private.total_bloco(p_version, p_bloco), p_bloco, v_eu.id, v_eu.email, v_eu.nome);
  update public.budget_blocks set status = p_decisao::public.orcamento_versao_status, decidido_em = now()
   where version_id = p_version and bloco = p_bloco;
end;
$$;

create or replace function public.decidir_bloco_orcamento(p_budget uuid, p_bloco text, p_decisao text, p_comentario text,
                                                          p_total_visto numeric)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao uuid;
  v_k public.budget_blocks%rowtype;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.can_approve(v_b.client_id) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  if v_b.status not in ('aguardando_aprovacao', 'em_analise') then
    raise exception 'Este orçamento não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  if p_decisao not in ('aprovado', 'alteracoes_solicitadas') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if p_decisao = 'alteracoes_solicitadas' and length(btrim(coalesce(p_comentario, ''))) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.' using errcode = 'P0001';
  end if;
  v_versao := private.versao_atual_orcamento(p_budget);
  perform 1 from public.budget_versions where id = v_versao for update;
  select * into v_k from public.budget_blocks where version_id = v_versao and bloco = p_bloco;
  if not found or v_k.status <> 'pendente' then
    raise exception 'Este bloco não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  if p_decisao = 'aprovado'
     and (p_total_visto is null or private.total_bloco(v_versao, p_bloco) <> round(p_total_visto, 2)) then
    raise exception 'Os valores deste bloco acabaram de mudar. Atualizamos a página: confira o novo total antes de aprovar.'
      using errcode = 'P0001';
  end if;

  perform private.decidir_bloco(p_budget, v_versao, p_bloco, p_decisao, p_comentario);
  perform set_config('app.transicao', 'on', true);
  update public.budgets set visualizado_em = coalesce(visualizado_em, now()) where id = p_budget;
  perform private.recalcular_orcamento(v_versao);
  perform set_config('app.transicao', '', true);
  return (select status from public.budgets where id = p_budget);
end;
$$;

-- Decisão do orçamento inteiro (telas antigas e orçamentos de um bloco só):
-- aplica a mesma decisão a todos os blocos pendentes.
create or replace function public.decidir_orcamento(p_budget uuid, p_decisao text, p_comentario text default null)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao public.budget_versions%rowtype;
  v_bloco text;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.can_approve(v_b.client_id) then
    raise exception 'Você não tem permissão para aprovar por esta empresa.' using errcode = '42501';
  end if;
  if v_b.status not in ('aguardando_aprovacao', 'em_analise') then
    raise exception 'Este orçamento não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  select * into v_versao from public.budget_versions where id = private.versao_atual_orcamento(p_budget) for update;
  if v_versao.status <> 'pendente' then
    raise exception 'Este orçamento não está aguardando aprovação.' using errcode = 'P0001';
  end if;
  if p_decisao not in ('aprovado', 'alteracoes_solicitadas') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if p_decisao = 'alteracoes_solicitadas' and length(btrim(coalesce(p_comentario, ''))) < 3 then
    raise exception 'Descreva o que precisa ser ajustado.' using errcode = 'P0001';
  end if;

  for v_bloco in select bloco from public.budget_blocks where version_id = v_versao.id and status = 'pendente' order by bloco loop
    perform private.decidir_bloco(p_budget, v_versao.id, v_bloco, p_decisao, p_comentario);
  end loop;
  perform set_config('app.transicao', 'on', true);
  update public.budgets set visualizado_em = coalesce(visualizado_em, now()) where id = p_budget;
  perform private.recalcular_orcamento(v_versao.id);
  perform set_config('app.transicao', '', true);
  return (select status from public.budgets where id = p_budget);
end;
$$;

-- ---------------------------------------------------------------------
-- Aprovação em reunião: todos os blocos que faltam, ou só os escolhidos.
-- ---------------------------------------------------------------------

drop function public.aprovar_orcamento_em_reuniao(uuid, timestamptz, text, text);

create function public.aprovar_orcamento_em_reuniao(
  p_budget uuid, p_reuniao_em timestamptz, p_aprovado_por text, p_observacao text default null, p_blocos text[] default null)
returns public.orcamento_status
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_v public.budget_versions%rowtype;
  v_eu public.profiles%rowtype;
  v_k record;
  v_n integer := 0;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status = 'cancelado' then
    raise exception 'Orçamento cancelado não pode ser aprovado.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.clients c where c.id = v_b.client_id and c.ativo) then
    raise exception 'O cliente está inativo.' using errcode = 'P0001';
  end if;
  perform private.validar_reuniao(p_reuniao_em, p_aprovado_por, p_observacao);

  select * into v_v from public.budget_versions where id = private.versao_atual_orcamento(p_budget);
  if v_v.status = 'rascunho' then
    perform public.enviar_orcamento(p_budget);
    select * into v_v from public.budget_versions where id = v_v.id;
  end if;
  if v_v.status = 'aprovado' then
    raise exception 'Este orçamento já está aprovado.' using errcode = 'P0001';
  end if;
  if v_v.status not in ('pendente', 'alteracoes_solicitadas') then
    raise exception 'Este orçamento não pode ser aprovado agora.' using errcode = 'P0001';
  end if;
  if p_blocos is not null and exists (
       select 1 from unnest(p_blocos) x(bloco)
        where not exists (select 1 from public.budget_blocks k where k.version_id = v_v.id and k.bloco = x.bloco
                            and k.status in ('pendente', 'alteracoes_solicitadas'))) then
    raise exception 'Algum bloco escolhido não existe ou já foi aprovado.' using errcode = 'P0001';
  end if;

  select * into v_eu from public.profiles where id = auth.uid();
  for v_k in select k.bloco from public.budget_blocks k
              where k.version_id = v_v.id and k.status in ('pendente', 'alteracoes_solicitadas')
                and (p_blocos is null or k.bloco = any (p_blocos))
              order by k.bloco loop
    insert into public.budget_approvals (version_id, budget_id, client_id, decisao, total, bloco, user_id, user_email, user_nome,
                                         via, reuniao_em, aprovado_por_cliente, observacao_reuniao)
    values (v_v.id, v_b.id, v_b.client_id, 'aprovado', private.total_bloco(v_v.id, v_k.bloco), v_k.bloco,
            v_eu.id, v_eu.email, v_eu.nome,
            'reuniao', p_reuniao_em, btrim(p_aprovado_por), nullif(btrim(coalesce(p_observacao, '')), ''));
    update public.budget_blocks set status = 'aprovado', decidido_em = now() where version_id = v_v.id and bloco = v_k.bloco;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Não há bloco para aprovar neste orçamento.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  perform private.recalcular_orcamento(v_v.id);
  perform set_config('app.transicao', '', true);
  return (select status from public.budgets where id = p_budget);
end;
$$;

-- ---------------------------------------------------------------------
-- Nova versão: copia também o bloco.
-- ---------------------------------------------------------------------

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
  insert into public.budget_lines (version_id, bloco, plataforma, descricao, projeto, valor, ordem)
  select v_nova, l.bloco, l.plataforma, l.descricao, l.projeto, l.valor, l.ordem
    from public.budget_lines l where l.version_id = v_atual.id;
  update public.budgets set status = 'em_revisao_interna', concluido_em = null where id = p_budget;
  perform set_config('app.transicao', '', true);
  return v_nova;
end;
$$;

-- ---------------------------------------------------------------------
-- P.I.: por bloco aprovado (um, vários ou todos), consolidado ou por canal.
-- A observação traz os projetos do P.I.
-- ---------------------------------------------------------------------

create or replace function public.emitir_pis(p_budget uuid, p_por_plataforma boolean, p_dados jsonb, p_blocos text[])
returns setof public.insertion_orders
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao public.budget_versions%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seq integer;
  v_cliente jsonb;
  v_agencia jsonb;
  v_grupo record;
  v_pi public.insertion_orders%rowtype;
  v_n integer := 0;
  v_falta text;
  v_obs text := nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), '');
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status = 'cancelado' then
    raise exception 'O P.I. só pode ser emitido de orçamento aprovado pelo cliente.' using errcode = 'P0001';
  end if;
  select * into v_versao from public.budget_versions where id = private.versao_atual_orcamento(p_budget);
  if v_versao.status in ('rascunho', 'substituida')
     or not exists (select 1 from public.budget_blocks k where k.version_id = v_versao.id and k.status = 'aprovado') then
    raise exception 'O P.I. só pode ser emitido de orçamento aprovado pelo cliente.' using errcode = 'P0001';
  end if;
  if p_blocos is not null then
    select x.bloco into v_falta from unnest(p_blocos) x(bloco)
     where not exists (select 1 from public.budget_blocks k where k.version_id = v_versao.id and k.bloco = x.bloco
                         and k.status = 'aprovado')
     limit 1;
    if v_falta is not null then
      raise exception 'O bloco "%" ainda não foi aprovado pelo cliente.', v_falta using errcode = 'P0001';
    end if;
  end if;
  if coalesce(p_dados ->> 'faturamento', '') not in ('bruto', 'liquido')
     or coalesce(p_dados ->> 'entrega_fatura', '') not in ('agencia', 'cliente') then
    raise exception 'Escolha a forma de faturamento e o local de entrega da fatura.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_dados ->> 'periodo', ''))) = 0
     or length(btrim(coalesce(p_dados ->> 'prazo_pagamento', ''))) = 0
     or length(btrim(coalesce(p_dados ->> 'campanha', ''))) = 0 then
    raise exception 'Preencha campanha, período e prazo para pagamento.' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'nome', c.nome_comercial, 'razao_social', c.razao_social, 'cnpj', c.cnpj, 'endereco', c.endereco,
           'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf, 'cep', c.cep, 'telefone', c.telefone,
           'email', c.email_contato)
    into v_cliente from public.clients c where c.id = v_b.client_id;
  select jsonb_build_object(
           'nome', a.nome, 'razao_social', a.razao_social, 'cnpj', a.cnpj, 'endereco', a.endereco,
           'bairro', a.bairro, 'cidade', a.cidade, 'uf', a.uf, 'cep', a.cep, 'telefone', a.telefone,
           'email', a.email)
    into v_agencia from public.agency_settings a where a.id;

  -- Numeração do dia: trava por data para dois P.I.s simultâneos não pegarem o mesmo número.
  perform pg_advisory_xact_lock(hashtext('pi:' || v_hoje::text));
  select coalesce(max(sequencia), 0) into v_seq from public.insertion_orders where data_emissao = v_hoje;

  -- Blocos e canais na ordem em que aparecem no orçamento; consolidado junta os canais do bloco.
  for v_grupo in
    with linhas as (
      select l.* from public.budget_lines l
        join public.budget_blocks k on k.version_id = l.version_id and k.bloco = l.bloco and k.status = 'aprovado'
       where l.version_id = v_versao.id and (p_blocos is null or l.bloco = any (p_blocos))),
    plat as (
      select l.bloco, l.plataforma, min(l.ordem) as ordem, sum(l.valor) as valor
        from linhas l group by l.bloco, l.plataforma),
    blocos as (select bloco, min(ordem) as ordem from plat group by bloco),
    grupos as (
      select p.bloco, case when p_por_plataforma then p.plataforma end as plataforma,
             string_agg(p.plataforma, ', ' order by p.ordem, p.plataforma) as veiculacao,
             sum(p.valor) as valor, min(p.ordem) as ordem
        from plat p
       group by p.bloco, case when p_por_plataforma then p.plataforma end)
    select g.*, (
             select string_agg(x.projeto, ', ' order by x.ordem)
               from (select l.projeto, min(l.ordem) as ordem from linhas l
                      where l.bloco = g.bloco and l.projeto is not null
                        and (g.plataforma is null or l.plataforma = g.plataforma)
                      group by l.projeto) x) as projetos
      from grupos g join blocos b on b.bloco = g.bloco
     order by b.ordem, g.bloco, g.ordem, 2
  loop
    v_seq := v_seq + 1;
    v_n := v_n + 1;
    insert into public.insertion_orders (
      numero, data_emissao, sequencia, budget_id, version_id, client_id, plataforma, veiculacao, valor, bloco,
      mes_referencia, campanha, periodo, prazo_pagamento, faturamento, entrega_fatura, observacoes,
      observacao_faturamento, dados_cliente, dados_agencia, created_by)
    values (
      to_char(v_hoje, 'YYMMDD') || '.' || lpad(v_seq::text, 2, '0'), v_hoje, v_seq, v_b.id, v_versao.id, v_b.client_id,
      v_grupo.plataforma, v_grupo.veiculacao, v_grupo.valor, v_grupo.bloco, v_b.mes_referencia,
      btrim(p_dados ->> 'campanha'), btrim(p_dados ->> 'periodo'), btrim(p_dados ->> 'prazo_pagamento'),
      p_dados ->> 'faturamento', p_dados ->> 'entrega_fatura',
      left(nullif(concat_ws(E'\n', 'Projetos: ' || v_grupo.projetos, v_obs), ''), 1500),
      nullif(btrim(coalesce(p_dados ->> 'observacao_faturamento', '')), ''),
      v_cliente, v_agencia, auth.uid())
    returning * into v_pi;
    return next v_pi;
  end loop;
  if v_n = 0 then
    raise exception 'O orçamento não tem linhas.' using errcode = 'P0001';
  end if;
  return;
end;
$$;

-- Assinatura antiga: todos os blocos aprovados.
create or replace function public.emitir_pis(p_budget uuid, p_por_plataforma boolean, p_dados jsonb)
returns setof public.insertion_orders
language sql security definer set search_path = ''
as $$ select * from public.emitir_pis(p_budget, p_por_plataforma, p_dados, null::text[]) $$;

revoke all on function public.emitir_pis(uuid, boolean, jsonb, text[]),
  public.decidir_bloco_orcamento(uuid, text, text, text, numeric),
  public.aprovar_orcamento_em_reuniao(uuid, timestamptz, text, text, text[]) from public, anon;
grant execute on function public.emitir_pis(uuid, boolean, jsonb, text[]),
  public.decidir_bloco_orcamento(uuid, text, text, text, numeric),
  public.aprovar_orcamento_em_reuniao(uuid, timestamptz, text, text, text[]) to authenticated;
revoke all on function private.recalcular_orcamento(uuid), private.decidir_bloco(uuid, uuid, text, text, text),
  private.total_bloco(uuid, text), private.bloco_igual(uuid, uuid, text) from public, anon, authenticated;
