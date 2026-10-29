-- Orçamento por projeto (migration 013). Conecta como "authenticator".
\set ON_ERROR_STOP on
set client_min_messages = notice;

select tests.login('equipe1');
set role authenticated;
insert into public.budgets (id, client_id, mes_referencia) values ('90000000-0000-0000-0000-000000000001', tests.id('nortis'), '2027-06-01');
insert into public.budget_lines (version_id, projeto, plataforma, descricao, valor, ordem)
select v.id, x.projeto, x.plataforma, x.objetivo, x.valor, x.ordem
  from public.budget_versions v,
       (values ('  Institucional   novo ', 'Meta Ads', 'Impulsionamento', 200, 1),
               ('Revista', 'Google Ads', 'MR | WP', 1500, 2),
               ('   ', 'LinkedIn Ads', null, 300, 3)) as x(projeto, plataforma, objetivo, valor, ordem)
 where v.budget_id = '90000000-0000-0000-0000-000000000001';
select tests.ok((select string_agg(coalesce(projeto, '(sem)'), ',' order by ordem) from public.budget_lines l
                   join public.budget_versions v on v.id = l.version_id where v.budget_id = '90000000-0000-0000-0000-000000000001')
                = 'Institucional novo,Revista,(sem)',
  'projeto sem espaços sobrando; em branco vira vazio');
do $$ begin
  insert into public.budget_lines (version_id, projeto, plataforma, valor)
  select v.id, repeat('x', 81), 'Meta Ads', 10 from public.budget_versions v where v.budget_id = '90000000-0000-0000-0000-000000000001';
  raise exception 'FALHOU: aceitou projeto com mais de 80 caracteres' using errcode = 'TF001';
exception when check_violation then raise notice 'ok  projeto tem no máximo 80 caracteres';
end $$;
select tests.ok((select count(*) = 0 from public.budget_changes where budget_id = '90000000-0000-0000-0000-000000000001'),
  'rascunho não entra no histórico');

select public.enviar_orcamento('90000000-0000-0000-0000-000000000001');
update public.budget_lines set projeto = 'Ebook Energia'
 where plataforma = 'LinkedIn Ads'
   and version_id = (select id from public.budget_versions where budget_id = '90000000-0000-0000-0000-000000000001');
select tests.ok((select acao = 'alterada' and projeto = 'Ebook Energia' and projeto_antes is null and valor_antes = valor_depois
                   from public.budget_changes where budget_id = '90000000-0000-0000-0000-000000000001'),
  'mudança só de projeto entra no histórico, com o antes e o depois');
update public.budget_lines set ordem = ordem + 10
 where version_id = (select id from public.budget_versions where budget_id = '90000000-0000-0000-0000-000000000001');
select tests.ok((select count(*) = 1 from public.budget_changes where budget_id = '90000000-0000-0000-0000-000000000001'),
  'mudar só a ordem continua fora do histórico');

select public.nova_versao_orcamento('90000000-0000-0000-0000-000000000001');
select tests.ok((select string_agg(projeto || '/' || coalesce(descricao, '-'), ',' order by ordem) from public.budget_lines l
                   join public.budget_versions v on v.id = l.version_id
                  where v.budget_id = '90000000-0000-0000-0000-000000000001' and v.numero = 2)
                = 'Institucional novo/Impulsionamento,Revista/MR | WP,Ebook Energia/-',
  'versão nova copia projeto e objetivo');
reset role;

select tests.login('cli_nortis');
set role authenticated;
select tests.ok((select projeto = 'Ebook Energia' and projeto_antes is null from public.budget_changes
                  where budget_id = '90000000-0000-0000-0000-000000000001'),
  'cliente vê a mudança de projeto no histórico');
reset role;
