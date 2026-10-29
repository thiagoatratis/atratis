-- =====================================================================
-- Atratis Approval · Orçamento por projeto (Projeto × Canal × Objetivo)
--
-- Decisões de 29/10/2026:
--   * Cada linha ganha um Projeto (ex.: Institucional, Revista, Ebook
--     Energia). A tabela agrupa as linhas por projeto e numera os canais.
--   * O Objetivo é o campo que antes se chamava "descrição" (mesma coluna,
--     só muda o nome na tela), então orçamentos antigos já aparecem com o
--     objetivo preenchido e o P.I. continua igual.
--   * Mudança de projeto depois do envio entra no histórico.
-- =====================================================================

alter table public.budget_lines
  add column projeto text,
  add constraint budget_lines_projeto_chk check (projeto is null or length(projeto) <= 80);

alter table public.budget_changes
  add column projeto text,
  add column projeto_antes text;

-- Linhas: além do que já fazia, limpa o projeto.
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
  new.aliquota := private.aliquota_plataforma(new.plataforma);
  return new;
end;
$$;

-- Histórico: também registra o projeto (e mudança só de projeto).
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
     and new.descricao is not distinct from old.descricao and new.projeto is not distinct from old.projeto then
    return new;  -- só mudou a ordem
  end if;
  select * into v_b from public.budgets where id = v_v.budget_id;
  select * into v_eu from public.profiles where id = v_actor;
  v_acao := case tg_op when 'INSERT' then 'incluida' when 'UPDATE' then 'alterada' else 'removida' end;
  insert into public.budget_changes (budget_id, version_id, client_id, acao, plataforma, descricao, projeto,
                                     plataforma_antes, descricao_antes, projeto_antes, valor_antes, valor_depois,
                                     status_orcamento, user_id, user_email, user_nome)
  values (v_b.id, v_v.id, v_b.client_id, v_acao,
          coalesce(new.plataforma, old.plataforma),
          case when tg_op = 'DELETE' then old.descricao else new.descricao end,
          case when tg_op = 'DELETE' then old.projeto else new.projeto end,
          case when tg_op = 'UPDATE' then old.plataforma end, case when tg_op = 'UPDATE' then old.descricao end,
          case when tg_op = 'UPDATE' then old.projeto end,
          case when tg_op <> 'INSERT' then old.valor end, case when tg_op <> 'DELETE' then new.valor end,
          v_b.status, v_eu.id, v_eu.email, v_eu.nome);
  return coalesce(new, old);
end;
$$;

-- Nova versão: copia também o projeto.
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
  insert into public.budget_lines (version_id, plataforma, descricao, projeto, valor, ordem)
  select v_nova, l.plataforma, l.descricao, l.projeto, l.valor, l.ordem
    from public.budget_lines l where l.version_id = v_atual.id;
  update public.budgets set status = 'em_revisao_interna', concluido_em = null where id = p_budget;
  perform set_config('app.transicao', '', true);
  return v_nova;
end;
$$;
