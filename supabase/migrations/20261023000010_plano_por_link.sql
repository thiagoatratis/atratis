-- =====================================================================
-- Atratis Approval · Etapa 5 · Plano por link
--
-- Decisão de 23/10/2026: a equipe escolhe, em cada plano, se o cliente vê o
-- PDF, o link da apresentação publicada no site da Atratis (com vídeos e
-- carrosséis funcionando) ou os dois.
--   * Só links de atratis.com.br (o link aparece dentro do portal).
--   * Com PDF e link juntos, os dois têm o mesmo número de slides.
--   * Só link: a equipe informa o total de slides.
--   * O conteúdo de um link pode mudar; por isso cada versão enviada usa um
--     endereço próprio (versão nova com o mesmo link não é enviada).
-- =====================================================================

create or replace function private.link_plano_valido(p_url text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_url is not null and length(p_url) <= 500
     and p_url ~ '^https://([a-z0-9-]+\.)*atratis\.com\.br(/[^\s"<>#]*)?$'
$$;
grant execute on function private.link_plano_valido(text) to authenticated, service_role;

alter table public.plan_versions add column link_url text;
alter table public.plan_versions drop constraint plan_versions_pdf_chk;
alter table public.plan_versions add constraint plan_versions_material_chk
  check ((paginas is null) = (pdf_path is null and link_url is null));
alter table public.plan_versions add constraint plan_versions_link_chk
  check (link_url is null or private.link_plano_valido(link_url));

-- Ajusta as seções do rascunho a um novo total de slides: as que passam do fim
-- saem, a última vai até o fim e, se mudou de tamanho, perde a aprovação mantida.
create or replace function private.ajustar_secoes_ao_total(p_version uuid, p_total integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.plan_sections where version_id = p_version and pagina_inicio > p_total;
  update public.plan_sections s
     set pagina_fim = p_total, mantem_aprovacao_de = null
   where s.version_id = p_version and s.pagina_fim <> p_total
     and s.ordem = (select max(o.ordem) from public.plan_sections o where o.version_id = p_version);
end;
$$;
revoke all on function private.ajustar_secoes_ao_total(uuid, integer) from public, anon, authenticated;

-- PDF: com link na versão, o PDF precisa ter o mesmo número de slides.
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
  if v_v.link_url is not null and p_paginas <> v_v.paginas then
    raise exception 'O PDF tem % slides e o link tem %. Os dois precisam ter o mesmo número de slides.', p_paginas, v_v.paginas
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'planos' and o.name = p_path) then
    raise exception 'O PDF ainda não foi enviado.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plan_versions set pdf_path = p_path, paginas = p_paginas where id = p_version;
  perform private.ajustar_secoes_ao_total(p_version, p_paginas);
  perform set_config('app.transicao', '', true);
end;
$$;

-- Link da apresentação publicada no site da Atratis, com o total de slides.
create or replace function public.definir_link_plano(p_version uuid, p_url text, p_slides integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.plan_versions;
  v_url text := split_part(btrim(coalesce(p_url, '')), '#', 1);
begin
  v_v := private.rascunho_do_plano(p_version);
  if not private.link_plano_valido(v_url) then
    raise exception 'Use um link https do site da Atratis (atratis.com.br).' using errcode = 'P0001';
  end if;
  if p_slides is null or p_slides < 1 or p_slides > 500 then
    raise exception 'Informe o total de slides (entre 1 e 500).' using errcode = 'P0001';
  end if;
  if v_v.pdf_path is not null and p_slides <> v_v.paginas then
    raise exception 'O link tem % slides e o PDF tem %. Os dois precisam ter o mesmo número de slides.', p_slides, v_v.paginas
      using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  update public.plan_versions set link_url = v_url, paginas = p_slides where id = p_version;
  perform private.ajustar_secoes_ao_total(p_version, p_slides);
  perform set_config('app.transicao', '', true);
end;
$$;

-- Tira o PDF ou o link do rascunho (o outro precisa continuar).
create or replace function public.remover_material_plano(p_version uuid, p_tipo text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_v public.plan_versions;
begin
  v_v := private.rascunho_do_plano(p_version);
  if p_tipo not in ('pdf', 'link') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if (p_tipo = 'pdf' and v_v.link_url is null) or (p_tipo = 'link' and v_v.pdf_path is null) then
    raise exception 'O plano precisa de um PDF ou de um link. Adicione o outro antes de tirar este.' using errcode = 'P0001';
  end if;
  perform set_config('app.transicao', 'on', true);
  if p_tipo = 'pdf' then
    update public.plan_versions set pdf_path = null where id = p_version;
  else
    update public.plan_versions set link_url = null where id = p_version;
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
  if v_v.pdf_path is null and v_v.link_url is null then
    raise exception 'Adicione o PDF ou o link do plano antes de enviar.' using errcode = 'P0001';
  end if;
  if v_v.pdf_path is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'planos' and o.name = v_v.pdf_path) then
    raise exception 'O PDF do plano não foi encontrado. Suba o arquivo de novo.' using errcode = 'P0001';
  end if;
  -- O link aprovado precisa continuar mostrando o que foi aprovado: versão nova, endereço novo.
  if v_v.link_url is not null and exists (
       select 1 from public.plan_versions o
        where o.plan_id = v_v.plan_id and o.id <> v_v.id and o.status <> 'rascunho' and o.link_url = v_v.link_url) then
    raise exception 'Este link já foi enviado numa versão anterior. Publique a versão nova em outro endereço (ex.: com -v2 no fim) e troque o link.'
      using errcode = 'P0001';
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
  insert into public.plan_versions (plan_id, numero, status, observacao, pdf_path, link_url, paginas)
  values (p_plan, v_atual.numero + 1, 'rascunho', nullif(btrim(coalesce(p_observacao, '')), ''),
          v_atual.pdf_path, v_atual.link_url, v_atual.paginas)
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

revoke all on function public.definir_link_plano(uuid, text, integer), public.remover_material_plano(uuid, text) from public, anon;
grant execute on function public.definir_link_plano(uuid, text, integer), public.remover_material_plano(uuid, text) to authenticated;
