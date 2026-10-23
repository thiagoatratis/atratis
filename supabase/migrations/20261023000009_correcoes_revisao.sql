-- =====================================================================
-- Correções da revisão (23/10/2026) sobre as migrations 007 e 008, que já
-- estavam aplicadas quando a revisão terminou.
--
-- Plano de comunicação:
--   * Cliente só vê plano que já foi enviado (cancelar um rascunho não o expõe).
--   * Aprovação só passa para a versão nova se for final (versão concluída),
--     e só na seção de mesmo nome e mesmo número de slides.
--   * PDF com mais slides: a última seção vai até o fim e, se mudou de tamanho,
--     perde a aprovação mantida.
--   * A variável app.transicao só libera mudanças dentro das funções de fluxo.
--   * Limpeza do autor só pela exclusão do usuário (não por UPDATE direto).
--   * Slides citados sem valores vazios; caminho do Storage com UUID estrito.
--   * Mensagens falam em "slide" em vez de "página".
-- Criativos e orçamentos:
--   * Limpeza do autor só pela exclusão do usuário.
--   * Cancelado antes de ser enviado não aparece para o cliente.
-- =====================================================================

-- Verdadeiro só dentro das funções de fluxo: elas ligam app.transicao e rodam
-- como dono do banco (security definer). Um usuário que ligasse a variável por
-- conta própria continua rodando como "authenticated" e é barrado.
create or replace function private.em_transicao()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(current_setting('app.transicao', true), '') = 'on'
     and current_user not in ('authenticated', 'anon')
$$;

-- Cliente com acesso à empresa e plano já enviado.
create or replace function private.cliente_ve_plano(p_plan uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'cliente', false)
     and exists (select 1 from public.plans p
                 where p.id = p_plan and p.status <> 'rascunho' and p.enviado_em is not null
                   and private.has_client_access(p.client_id))
$$;

-- Plano: status e datas só mudam pelo fluxo; o cliente do plano não muda.
create or replace function private.proteger_plano()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.em_transicao() then
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

-- Versão: fora do fluxo, só a nota ao cliente do rascunho pode mudar.
create or replace function private.proteger_versao_plano()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if private.em_transicao() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Versão nova só pelo botão "Nova versão".' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Versão de plano não pode ser apagada.' using errcode = '42501';
  end if;
  -- Excluir do sistema quem criou a versão só limpa o autor (on delete set null,
  -- que roda dentro de outro gatilho; um UPDATE direto não passa por aqui).
  if pg_trigger_depth() > 1 and old.created_by is not null and new.created_by is null
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
  if private.em_transicao() then
    return coalesce(new, old);
  end if;
  raise exception 'Use as funções do plano para alterar este registro.' using errcode = '42501';
end;
$$;

-- Aprovações que ainda valem antes da versão p_numero: as seções aprovadas da
-- última versão enviada, desde que a decisão seja final (versão concluída) ou
-- já fosse uma aprovação mantida. Devolve o id da aprovação original.
create or replace function private.aprovacoes_em_vigor(p_plan uuid, p_numero integer)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(coalesce(s.mantem_aprovacao_de, s.id)), '{}')
    from public.plan_sections s
    join public.plan_versions v on v.id = s.version_id
   where v.id = (select pv.id from public.plan_versions pv
                  where pv.plan_id = p_plan and pv.numero < p_numero and pv.status <> 'rascunho'
                  order by pv.numero desc limit 1)
     and s.status = 'aprovada'
     and (v.status = 'concluida' or s.mantem_aprovacao_de is not null)
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
    raise exception 'O PDF precisa ter entre 1 e 500 slides.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'planos' and o.name = p_path) then
    raise exception 'O PDF ainda não foi enviado.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plan_versions set pdf_path = p_path, paginas = p_paginas where id = p_version;
  -- Seções que passam do fim do PDF novo são descartadas e a última passa a ir
  -- até o fim. Seção que muda de tamanho perde a aprovação mantida. A equipe revisa.
  delete from public.plan_sections where version_id = p_version and pagina_inicio > p_paginas;
  update public.plan_sections s
     set pagina_fim = p_paginas, mantem_aprovacao_de = null
   where s.version_id = p_version and s.pagina_fim <> p_paginas
     and s.ordem = (select max(o.ordem) from public.plan_sections o where o.version_id = p_version);
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
  v_origem public.plan_sections%rowtype;
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
      raise exception 'A seção "%" deveria começar no slide %.', v_nome, v_prox using errcode = 'P0001';
    end if;
    if v_fim is null or v_fim < v_ini or v_fim > v_v.paginas then
      raise exception 'A seção "%" termina num slide inválido.', v_nome using errcode = 'P0001';
    end if;
    if v_mantem is not null then
      if not v_requer then
        raise exception 'A seção "%" é informativa e não tem aprovação a manter.', v_nome using errcode = 'P0001';
      end if;
      -- Só vale a aprovação em vigor na última versão enviada (decisão final do
      -- cliente), uma vez por seção, com o mesmo nome e o mesmo número de slides.
      if v_mantem = any (v_vistos) or v_mantem <> all (private.aprovacoes_em_vigor(v_v.plan_id, v_v.numero)) then
        raise exception 'A seção "%" não tem uma aprovação anterior válida para manter.', v_nome using errcode = 'P0001';
      end if;
      select * into v_origem from public.plan_sections where id = v_mantem;
      if lower(btrim(v_origem.nome)) <> lower(v_nome)
         or (v_origem.pagina_fim - v_origem.pagina_inicio) <> (v_fim - v_ini) then
        raise exception 'A seção "%" mudou de nome ou de número de slides; ela precisa de nova aprovação.', v_nome
          using errcode = 'P0001';
      end if;
      v_vistos := v_vistos || v_mantem;
    end if;
    insert into public.plan_sections (version_id, ordem, nome, pagina_inicio, pagina_fim, requer_aprovacao, mantem_aprovacao_de)
    values (p_version, v_ordem, v_nome, v_ini, v_fim, v_requer, v_mantem);
    v_prox := v_fim + 1;
  end loop;

  if v_prox <> v_v.paginas + 1 then
    raise exception 'As seções precisam ir até o último slide (%).', v_v.paginas using errcode = 'P0001';
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
    raise exception 'Marque as seções do plano até o último slide.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.plan_sections s join public.plan_sections o on o.id = s.mantem_aprovacao_de
             where s.version_id = v_v.id
               and (o.pagina_fim - o.pagina_inicio <> s.pagina_fim - s.pagina_inicio
                    or lower(btrim(o.nome)) <> lower(btrim(s.nome)))) then
    raise exception 'Uma seção com aprovação mantida mudou de nome ou de número de slides. Revise as seções.'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.plan_sections s
                 where s.version_id = v_v.id and s.requer_aprovacao and s.mantem_aprovacao_de is null) then
    raise exception 'Nenhuma seção desta versão precisa de aprovação. Nas seções que mudaram, escolha "Mudou: precisa de nova aprovação".'
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
         -- Aprovação dada numa versão que o cliente ainda não terminou não é final:
         -- volta para ele decidir.
         case when s.status = 'aprovada' and (v_atual.status = 'concluida' or s.mantem_aprovacao_de is not null)
              then coalesce(s.mantem_aprovacao_de, s.id) end
    from public.plan_sections s where s.version_id = v_atual.id;
  update public.plans set status = 'em_revisao_interna', concluido_em = null where id = p_plan;
  perform set_config('app.transicao', '', true);
  return v_nova;
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
  select coalesce(array_agg(distinct x order by x), '{}') into v_slides
    from unnest(coalesce(p_slides, '{}')) x where x is not null;
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

-- Ler: equipe com acesso ao cliente; cliente só o PDF de versão já enviada.
create or replace function private.pode_ler_plano(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (private.is_staff() and private.has_client_access(
            case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then split_part(p_name, '/', 1)::uuid end))
      or exists (select 1 from public.plan_versions v
                 where v.pdf_path = p_name and v.status <> 'rascunho'
                   and private.cliente_ve_plano(v.plan_id))
$$;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and enviado_em is not null and private.has_client_access(client_id)));

revoke all on function private.aprovacoes_em_vigor(uuid, integer) from public, anon;
grant execute on function private.aprovacoes_em_vigor(uuid, integer) to authenticated;
grant execute on function private.em_transicao() to authenticated, service_role;

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

drop policy if exists requests_select on public.creative_requests;
create policy requests_select on public.creative_requests for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and enviado_em is not null and private.has_client_access(client_id)));

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using ((private.is_staff() and private.has_client_access(client_id))
         or (coalesce(private.current_app_role() = 'cliente', false)
             and status <> 'rascunho' and enviado_em is not null and private.has_client_access(client_id)));
