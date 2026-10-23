-- =====================================================================
-- Correção (23/10/2026): admin não conseguia cadastrar cliente pelo site.
--
-- O site grava com INSERT ... RETURNING. Para devolver a linha, o Postgres
-- aplica a política de leitura de "clients", que chama has_client_access.
-- Para o admin, essa função procurava o cliente na própria tabela, mas a
-- linha que está sendo criada ainda não é visível dentro do mesmo comando,
-- e o cadastro era recusado com "violates row-level security policy".
--
-- Agora o admin tem acesso a qualquer cliente sem consultar a tabela.
-- As demais regras (equipe e cliente) não mudam.
-- =====================================================================

create or replace function private.has_client_access(p_client uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.current_app_role()
    when 'admin' then p_client is not null
    when 'equipe' then exists (
      select 1 from public.staff_client_access s
      where s.client_id = p_client and s.user_id = auth.uid())
    when 'cliente' then exists (
      select 1 from public.client_members m
      join public.clients c on c.id = m.client_id
      where m.client_id = p_client and m.user_id = auth.uid() and m.ativo and c.ativo)
    else false
  end
$$;
