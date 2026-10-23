-- =====================================================================
-- Atratis Approval · Etapa 4 · Pedidos de Inserção (P.I.)
--
-- Decisões de 22 e 23/10/2026:
--   * P.I. sai de orçamento aprovado, por botão da equipe: um consolidado
--     ou um por plataforma.
--   * Número AAMMDD.NN pela data de emissão no horário de Brasília; a
--     contagem recomeça a cada dia e cada P.I. por plataforma pega o próximo
--     número do dia. Número nunca é reaproveitado, nem de P.I. cancelado.
--   * Valor do P.I. = valor do boleto (com o imposto do Meta Ads incluso).
--   * Faturamento: padrão do modelo (prazo "Data do vencimento do boleto",
--     Bruto, fatura entregue ao Cliente), editável em cada emissão.
--   * Período: datas do mês de referência, editável.
--   * Equipe e cliente veem e baixam o P.I.
--
-- O P.I. guarda um retrato dos dados do cliente e da agência no momento da
-- emissão: mudar o cadastro depois não altera P.I. já emitido. O PDF é
-- gerado no navegador a partir desse retrato e guardado no Storage.
-- =====================================================================

create table public.insertion_orders (
  id                      uuid primary key default gen_random_uuid(),
  numero                  text not null,
  data_emissao            date not null,
  sequencia               integer not null,
  budget_id               uuid not null references public.budgets (id) on delete restrict,
  version_id              uuid not null references public.budget_versions (id) on delete restrict,
  client_id               uuid not null references public.clients (id) on delete restrict,
  plataforma              text,            -- null = P.I. consolidado
  veiculacao              text not null,
  valor                   numeric(14, 2) not null,
  mes_referencia          date not null,
  campanha                text not null,
  periodo                 text not null,
  prazo_pagamento         text not null,
  faturamento             text not null,
  entrega_fatura          text not null,
  observacoes             text,
  observacao_faturamento  text,
  dados_cliente           jsonb not null,
  dados_agencia           jsonb not null,
  pdf_path                text,
  status                  text not null default 'emitido',
  cancelado_em            timestamptz,
  motivo_cancelamento     text,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles (id) on delete set null,
  constraint insertion_orders_numero_uq unique (numero),
  constraint insertion_orders_seq_uq unique (data_emissao, sequencia),
  constraint insertion_orders_valor_chk check (valor > 0),
  constraint insertion_orders_faturamento_chk check (faturamento in ('bruto', 'liquido')),
  constraint insertion_orders_entrega_chk check (entrega_fatura in ('agencia', 'cliente')),
  constraint insertion_orders_status_chk check (status in ('emitido', 'cancelado')),
  constraint insertion_orders_textos_chk check (
    length(btrim(periodo)) between 1 and 120 and length(btrim(prazo_pagamento)) between 1 and 120
    and length(btrim(campanha)) between 1 and 160
    and (observacoes is null or length(observacoes) <= 1500)
    and (observacao_faturamento is null or length(observacao_faturamento) <= 500))
);
create index insertion_orders_budget_idx on public.insertion_orders (budget_id, created_at);
create index insertion_orders_client_idx on public.insertion_orders (client_id, data_emissao desc);

-- ---------------------------------------------------------------------
-- Proteção: P.I. emitido não muda. Só o caminho do PDF (uma vez gravado
-- pela função registrar_pdf_pi) e o cancelamento, ambos pelas funções.
-- ---------------------------------------------------------------------
create or replace function private.proteger_pi()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- Exclusão de usuário: a chave estrangeira só limpa quem emitiu; o resto continua igual.
  if tg_op = 'UPDATE' and old.created_by is not null and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  if coalesce(current_setting('app.transicao', true), '') <> 'on' then
    raise exception 'P.I. emitido não pode ser alterado nem apagado. Cancele e emita outro.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'P.I. emitido não pode ser apagado.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger insertion_orders_protect before update or delete on public.insertion_orders
  for each row execute function private.proteger_pi();
create trigger insertion_orders_audit after insert or update on public.insertion_orders
  for each row execute function private.audit_row('pi', 'client_id');

-- ---------------------------------------------------------------------
-- Emissão
-- ---------------------------------------------------------------------

-- p_dados: campanha, periodo, prazo_pagamento, faturamento, entrega_fatura,
-- observacoes, observacao_faturamento.
create or replace function public.emitir_pis(p_budget uuid, p_por_plataforma boolean, p_dados jsonb)
returns setof public.insertion_orders
language plpgsql security definer set search_path = ''
as $$
declare
  v_b public.budgets%rowtype;
  v_versao uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_seq integer;
  v_cliente jsonb;
  v_agencia jsonb;
  v_grupo record;
  v_pi public.insertion_orders%rowtype;
  v_n integer := 0;
begin
  select * into v_b from public.budgets where id = p_budget for update;
  if not found or not private.staff_pode_orcamento(p_budget) then
    raise exception 'Orçamento não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if v_b.status <> 'aprovado' then
    raise exception 'O P.I. só pode ser emitido de orçamento aprovado pelo cliente.' using errcode = 'P0001';
  end if;
  v_versao := private.versao_atual_orcamento(p_budget);
  if (select status from public.budget_versions where id = v_versao) <> 'aprovado' then
    raise exception 'A versão atual do orçamento não está aprovada.' using errcode = 'P0001';
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

  -- Plataformas na ordem em que aparecem no orçamento; consolidado junta todas.
  for v_grupo in
    with plat as (
      select l.plataforma, min(l.ordem) as ordem, sum(l.valor) as valor
        from public.budget_lines l where l.version_id = v_versao group by l.plataforma)
    select case when p_por_plataforma then plat.plataforma end as plataforma,
           string_agg(plat.plataforma, ', ' order by plat.ordem, plat.plataforma) as veiculacao,
           sum(plat.valor) as valor
      from plat
     group by case when p_por_plataforma then plat.plataforma end
     order by min(plat.ordem), 1
  loop
    v_seq := v_seq + 1;
    v_n := v_n + 1;
    insert into public.insertion_orders (
      numero, data_emissao, sequencia, budget_id, version_id, client_id, plataforma, veiculacao, valor,
      mes_referencia, campanha, periodo, prazo_pagamento, faturamento, entrega_fatura, observacoes,
      observacao_faturamento, dados_cliente, dados_agencia, created_by)
    values (
      to_char(v_hoje, 'YYMMDD') || '.' || lpad(v_seq::text, 2, '0'), v_hoje, v_seq, v_b.id, v_versao, v_b.client_id,
      v_grupo.plataforma, v_grupo.veiculacao, v_grupo.valor, v_b.mes_referencia,
      btrim(p_dados ->> 'campanha'), btrim(p_dados ->> 'periodo'), btrim(p_dados ->> 'prazo_pagamento'),
      p_dados ->> 'faturamento', p_dados ->> 'entrega_fatura',
      nullif(btrim(coalesce(p_dados ->> 'observacoes', '')), ''),
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

-- Grava o caminho do PDF gerado no navegador (pasta do cliente, nome = id do P.I.).
create or replace function public.registrar_pdf_pi(p_pi uuid, p_path text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_pi public.insertion_orders%rowtype;
begin
  select * into v_pi from public.insertion_orders where id = p_pi for update;
  if not found or not private.staff_pode_orcamento(v_pi.budget_id) then
    raise exception 'P.I. não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if p_path <> v_pi.client_id || '/' || v_pi.id || '.pdf' then
    raise exception 'Caminho do PDF inválido.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'pis' and o.name = p_path) then
    raise exception 'O PDF ainda não foi enviado.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.insertion_orders set pdf_path = p_path where id = p_pi and pdf_path is distinct from p_path;
  perform set_config('app.transicao', '', true);
end;
$$;

create or replace function public.cancelar_pi(p_pi uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_pi public.insertion_orders%rowtype;
begin
  select * into v_pi from public.insertion_orders where id = p_pi for update;
  if not found or not private.staff_pode_orcamento(v_pi.budget_id) then
    raise exception 'P.I. não encontrado ou sem permissão.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.insertion_orders
     set status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   where id = p_pi and status = 'emitido';
  perform set_config('app.transicao', '', true);
end;
$$;

revoke all on function public.emitir_pis(uuid, boolean, jsonb), public.registrar_pdf_pi(uuid, text),
  public.cancelar_pi(uuid, text) from public, anon;
grant execute on function public.emitir_pis(uuid, boolean, jsonb), public.registrar_pdf_pi(uuid, text),
  public.cancelar_pi(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS: equipe com acesso ao cliente e o próprio cliente leem; ninguém
-- grava direto na tabela (só pelas funções acima).
-- ---------------------------------------------------------------------
alter table public.insertion_orders enable row level security;

create policy insertion_orders_select on public.insertion_orders for select to authenticated
  using (private.has_client_access(client_id));

revoke all on public.insertion_orders from anon;
revoke insert, update, delete, truncate on public.insertion_orders from authenticated;

-- ---------------------------------------------------------------------
-- Storage: bucket privado com os PDFs. Caminho: {client_id}/{pi_id}.pdf
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pis', 'pis', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Enviar: equipe com acesso, para um P.I. existente daquele cliente, no nome certo.
create or replace function private.pode_enviar_pi(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.insertion_orders i
    where i.client_id || '/' || i.id || '.pdf' = p_name
      and private.staff_pode_orcamento(i.budget_id))
$$;

-- Ler: quem enxerga o P.I. (equipe com acesso ou o cliente).
create or replace function private.pode_ler_pi(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.insertion_orders i
    where i.client_id || '/' || i.id || '.pdf' = p_name
      and private.has_client_access(i.client_id))
$$;

grant execute on function private.pode_enviar_pi(text), private.pode_ler_pi(text) to authenticated;

create policy pis_select on storage.objects for select to authenticated
  using (bucket_id = 'pis' and private.pode_ler_pi(name));
create policy pis_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pis' and private.pode_enviar_pi(name));
