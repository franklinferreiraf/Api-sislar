# Grupo 3 — Decisões pendentes e suposições

Cada linha registra o que foi assumido e onde está no código, para trocar sem caçar valor fixo. "Configurável" quer dizer que o valor fica no banco (`grupo3.configuracao` ou numa coluna do tipo de atendimento), não no código.

## Decisões da instituição ainda em aberto

| ID | Tema | Suposição adotada | Onde está |
|---|---|---|---|
| **D-001** | Perfis exatos do sistema | Matriz módulo × ação aprovada (ver [README](README.md#matriz-de-permissões)). **O voluntário não vê a agenda geral, só a própria (`GET /api/me/agenda`).** Qualquer usuário autenticado com colaborador vinculado vê a própria agenda, e o profissional do agendamento sempre vê o detalhe e o histórico dele. | `src/lib/permissions.js` (`ROLE_PERMISSIONS`); `/me/agenda` e `acessarAgendamento()` em `src/routes/grupo3/agendamentos.js` |
| **D-008** | Canais dos lembretes | Só notificação interna (`public.notifications`). O canal fica atrás da porta de notificações. | Fatia 2 — `src/grupo3/portas/notificacoes.js` |
| **D-010** | Preenchimento da escala de médicos voluntários | Cadastro manual, sem recorrência nem integração. | Fatia 3 |
| **D-013** | Relatórios obrigatórios | Relatórios P2 viram endpoints JSON com filtros; exportação PDF/planilha fica com o Grupo 5. | Fatia 7 |
| **D-017** | Infraestrutura de produção | Conexão, segredo, CORS e porta vêm de variáveis de ambiente (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`). Os jobs da Fatia 2 serão ligados por `JOBS_ENABLED`. | `src/config.js`, `.env.example` |
| US-076 | Campos da atividade de fisioterapia | Campos fixos (descrição, frequência, duração, observações) + `configuracao jsonb` validado por zod (chaves livres, tamanho limitado). | Fatia 5 |
| US-086 | Conteúdo do registro de consulta | Campos mínimos (profissional, data/hora, tipo, resumo/resultado) + `conteudo jsonb` validado. | Fatia 4 |

## Regras configuráveis

| Regra | Padrão | Onde configura |
|---|---|---|
| Motivo obrigatório ao cancelar | Ligado (`true`) | `grupo3.tipo_atendimento.exige_motivo_cancelamento`, por tipo |
| Motivo obrigatório ao reagendar | Ligado (`true`) | `grupo3.tipo_atendimento.exige_motivo_reagendamento`, por tipo |
| Exceção à regra de conflito | Desligada | `grupo3.tipo_atendimento.permite_sobreposicao`. Só vale entre agendamentos do **mesmo tipo**; tipos diferentes sempre conflitam |
| Fuso da instituição | `America/Sao_Paulo` | `grupo3.configuracao`, chave `fuso_horario` |
| **Ciclo do acompanhamento odontológico** | `semestre_civil` (jan–jun / jul–dez) | Fatia 4: `grupo3.configuracao`, chave `odontologia.ciclo` = `{ "modo": "semestre_civil" \| "dias_corridos", "dias": 180 }`. `GET /api/odontologia/pendencias?ciclo=AAAA-S` (ex.: `2026-2`) no modo semestre civil; em `dias_corridos`, o ciclo é contado da data de referência para trás |
| Antecedência dos lembretes | 24 h | Fatia 2: `grupo3.configuracao` (padrão) e por tipo de atendimento |
| Cobertura mínima da escala | Sem cobertura cadastrada | Fatia 3: tabela `grupo3.cobertura_necessaria` |

## Suposições técnicas

| Tema | Suposição | Onde está |
|---|---|---|
| Idoso ativo | `public.patients` não tem status de inativação; todo idoso cadastrado é tratado como ativo. | `src/grupo3/portas/idosos.js` — `TODO(integracao-G1)` |
| Visibilidade do prontuário (US-031) | Ainda não existe. O G3 exige a permissão clínica do módulo e consulta `podeVerIdoso()`, que hoje libera. | `src/grupo3/portas/prontuario.js` — `TODO(integracao-G1)` |
| LGPD na agenda | Categorias clínicas: `consulta_medica`, `consulta_odontologica`, `avaliacao` (exigem `atendimento-clinico.visualizar`) e `fisioterapia` (exige `fisioterapia.visualizar`). Sem a permissão, o texto livre volta `null`. | `PERMISSAO_CLINICA` em `src/grupo3/regras.js` |
| Realização antes do horário | Recusada (422): realizado e não realizado só depois do início. Desmarcar antes do horário é cancelamento. | `POST /agendamentos/{id}/realizacao` |
| Responsável pela realização | Se não for informado: o colaborador do usuário logado; sem vínculo, o profissional do agendamento. O usuário que registrou fica na auditoria e no histórico. | `POST /agendamentos/{id}/realizacao` |
| Lembrete sem destinatário | Colaborador sem `usuario_ref` gera lembrete com status `sem_destinatario`, visível em `GET /agendamentos/{id}/lembretes`, em vez de falha silenciosa. | Fatia 2 |
| Formato de erro | Mantido o do repositório, `{ error: { message, details } }`, e não ProblemDetails. | `src/middleware/error.js` |
| Base dos paths | `/api`, sem `/v1`, como o resto da API. | `src/routes/grupo3/index.js` |
| Migrations | O repositório não tem migrations incrementais: `db:setup` recria o banco a partir de `sql/*.sql`. O schema do G3 é `sql/grupo3.sql`. Migração incremental é decisão da Fundação. | `src/db/reset.js` |
| Agenda legada | `/api/agenda`, `/api/atendimentos` e `/api/funcionarios` ficam intactas e marcadas como obsoletas no OpenAPI. Não há migração de dados de `agenda_events` e `appointments`. | `src/docs/openapi.js` |
| Auditoria de negação | Respostas 403 não são auditadas pelo G3 (cabe à Fundação). Recusas por conflito de agenda são auditadas. | `auditarRecusa()` em `src/routes/grupo3/agendamentos.js` |
