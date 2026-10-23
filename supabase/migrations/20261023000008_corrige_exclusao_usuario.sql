-- =====================================================================
-- Correções (23/10/2026), encontradas na revisão antes da etapa 5:
--
-- 1. Excluir um usuário no painel do Supabase era barrado quando ele tinha
--    criado versões de peça ou de orçamento já enviadas ao cliente. Ao
--    excluir, o banco limpa o autor das versões (created_by vira vazio) e as
--    proteções de "versão enviada não muda" barravam essa limpeza. Agora a
--    limpeza passa, mas só quando vem da exclusão (dentro de outro gatilho);
--    um UPDATE direto no autor continua barrado.
--
-- 2. Solicitação de criativos ou orçamento cancelado ainda em rascunho
--    (nunca enviado) aparecia para o cliente, com o motivo interno do
--    cancelamento. Agora o cliente só vê o que já foi enviado alguma vez.
-- =====================================================================

-- Chamada de dentro do gatilho de proteção: profundidade 1 é um UPDATE direto;
-- a limpeza feita pela exclusão do usuário (on delete set null) chega com 2.
create or replace function private.so_limpa_autor(p_new jsonb, p_old jsonb)
returns boolean
language sql stable set search_path = ''
as $$
  select pg_trigger_depth() > 1
     and (p_old ->> 'created_by') is not null and (p_new ->> 'created_by') is null
     and (p_new - 'created_by' - 'updated_at') = (p_old - 'created_by' - 'updated_at')
$$;

-- Criativos
create or replace function private.proteger_versao()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('app.transicao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and private.so_limpa_autor(to_jsonb(new), to_jsonb(old)) then
    return new;
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

-- Orçamentos
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
  if private.so_limpa_autor(to_jsonb(new), to_jsonb(old)) then
    return new;
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

grant execute on function private.so_limpa_autor(jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Cliente só vê o que já foi enviado
-- ---------------------------------------------------------------------

create or replace function private.cliente_ve_request(p_request uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.creative_requests r
                 where r.id = p_request and r.status <> 'rascunho' and r.enviado_em is not null
                   and private.has_client_access(r.client_id))
$$;

create or replace function private.cliente_ve_orcamento(p_budget uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.budgets b
                 where b.id = p_budget and b.status <> 'rascunho' and b.enviado_em is not null
                   and private.has_client_access(b.client_id))
$$;

drop policy requests_select on public.creative_requests;
create policy requests_select on public.creative_requests for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and enviado_em is not null and private.has_client_access(client_id)));

drop policy budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and enviado_em is not null and private.has_client_access(client_id)));
