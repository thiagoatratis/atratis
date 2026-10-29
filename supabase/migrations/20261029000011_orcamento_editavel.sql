-- =====================================================================
-- Atratis Approval · Orçamento editável depois de enviado, com histórico
--
-- Decisões de 29/10/2026 (substituem "mudou depois do envio = versão nova"):
--   * A equipe muda os valores da versão atual mesmo depois de enviada;
--     o cliente vê os valores novos e um aviso de que mudaram.
--   * Orçamento já aprovado continua aprovado depois de uma mudança; o
--     histórico mostra que mudou depois da aprovação.
--   * Cliente que pediu alteração recebe o mesmo orçamento de volta
--     (reenvio), sem precisar de versão nova. "Nova versão" continua existindo.
--   * Equipe e cliente veem o histórico: o que mudou, de quanto para quanto,
--     quem e quando. Só entram mudanças feitas depois do primeiro envio.
--   * P.I. já emitido não muda: ele guarda os valores da emissão.
-- =====================================================================

create table public.budget_changes (
  id               bigint generated always as identity primary key,
  budget_id        uuid not null references public.budgets (id) on delete restrict,
  version_id       uuid not null references public.budget_versions (id) on delete restrict,
  client_id        uuid not null references public.clients (id) on delete restrict,
  acao             text not null,
  plataforma       text not null,
  descricao        text,
  plataforma_antes text,
  descricao_antes  text,
  valor_antes      numeric(14, 2),
  valor_depois     numeric(14, 2),
  -- Situação do orçamento no momento da mudança (ex.: "aprovado").
  status_orcamento public.orcamento_status not null,
  user_id          uuid,
  user_email       text,
  user_nome        text,
  created_at       timestamptz not null default now(),
  constraint budget_changes_acao_chk check (acao in ('incluida', 'alterada', 'removida'))
);
create index budget_changes_budget_idx on public.budget_changes (budget_id, created_at);

create trigger budget_changes_immutable before update or delete on public.budget_changes
  for each row execute function private.registro_imutavel();

alter table public.budget_changes enable row level security;
create policy budget_changes_select on public.budget_changes for select to authenticated
  using (private.staff_pode_orcamento(budget_id) or private.cliente_ve_orcamento(budget_id));
revoke all on public.budget_changes from anon;
revoke insert, update, delete, truncate on public.budget_changes from authenticated;

-- Linhas: editáveis na versão atual, enviada ou não, enquanto o orçamento não
-- for cancelado. Versão substituída (ou anterior) continua congelada.
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
  new.aliquota := private.aliquota_plataforma(new.plataforma);
  return new;
end;
$$;

-- Registra as mudanças feitas depois do envio (rascunho não entra no histórico).
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
begin
  select * into v_v from public.budget_versions where id = coalesce(new.version_id, old.version_id);
  if v_v.status = 'rascunho' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.valor = old.valor and new.plataforma = old.plataforma
     and new.descricao is not distinct from old.descricao then
    return new;  -- só mudou a ordem
  end if;
  select * into v_b from public.budgets where id = v_v.budget_id;
  select * into v_eu from public.profiles where id = v_actor;
  v_acao := case tg_op when 'INSERT' then 'incluida' when 'UPDATE' then 'alterada' else 'removida' end;
  insert into public.budget_changes (budget_id, version_id, client_id, acao, plataforma, descricao,
                                     plataforma_antes, descricao_antes, valor_antes, valor_depois,
                                     status_orcamento, user_id, user_email, user_nome)
  values (v_b.id, v_v.id, v_b.client_id, v_acao,
          coalesce(new.plataforma, old.plataforma), case when tg_op = 'DELETE' then old.descricao else new.descricao end,
          case when tg_op = 'UPDATE' then old.plataforma end, case when tg_op = 'UPDATE' then old.descricao end,
          case when tg_op <> 'INSERT' then old.valor end, case when tg_op <> 'DELETE' then new.valor end,
          v_b.status, v_eu.id, v_eu.email, v_eu.nome);
  return coalesce(new, old);
end;
$$;

create trigger budget_lines_historico after insert or update or delete on public.budget_lines
  for each row execute function private.registrar_alteracao_orcamento();

-- Envio: também reenvia a versão em que o cliente pediu alteração.
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
  if v_versao.status not in ('rascunho', 'alteracoes_solicitadas') then
    raise exception 'Este orçamento já está com o cliente. As mudanças nos valores aparecem para ele na hora.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.budget_lines l where l.version_id = v_versao.id) then
    raise exception 'Adicione pelo menos uma linha antes de enviar.' using errcode = 'P0001';
  end if;

  perform set_config('app.transicao', 'on', true);
  update public.budget_versions set status = 'pendente', enviado_em = now(), decidido_em = null where id = v_versao.id;
  update public.budgets
     set status = 'aguardando_aprovacao', enviado_em = now(), visualizado_em = null, concluido_em = null
   where id = p_budget;
  perform set_config('app.transicao', '', true);
  return 'aguardando_aprovacao';
end;
$$;
