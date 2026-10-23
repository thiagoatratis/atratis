-- =====================================================================
-- Correção (23/10/2026): excluir um usuário no painel do Supabase era
-- barrado quando ele tinha criado versões de peça ou de orçamento já
-- enviadas ao cliente.
--
-- Ao excluir o usuário, o banco limpa o autor das versões (created_by
-- vira vazio). As proteções de "versão enviada não muda" barravam essa
-- limpeza. Agora a limpeza do autor passa; qualquer outra mudança em
-- versão enviada continua barrada.
-- =====================================================================

create or replace function private.so_limpa_autor(p_new jsonb, p_old jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select (p_old ->> 'created_by') is not null and (p_new ->> 'created_by') is null
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
