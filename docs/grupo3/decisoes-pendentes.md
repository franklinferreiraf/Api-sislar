# Grupo 3 — Decisões pendentes e suposições

Cada linha registra o que foi assumido e onde está no código, para trocar sem caçar valor fixo. "Configurável" quer dizer que o valor fica no banco (`grupo3.configuracao` ou numa coluna do tipo de atendimento), não no código.

## Decisões da instituição ainda em aberto

| ID | Tema | Suposição adotada | Onde está |
|---|---|---|---|
| **D-001** | Perfis exatos do sistema | Matriz módulo × ação aprovada (ver [README](README.md#matriz-de-permissões)). **O voluntário não vê a agenda geral, só a própria (`GET /api/me/agenda`).** Qualquer usuário autenticado com colaborador vinculado vê a própria agenda, e o profissional do agendamento sempre vê o detalhe e o histórico dele. | `src/lib/permissions.js` (`ROLE_PERMISSIONS`); `/me/agenda` e `acessarAgendamento()` em `src/routes/grupo3/agendamentos.js` |
| **D-008** | Canais dos lembretes | Só notificação interna (`public.notifications`), já considerada entregue ao ser gravada. O canal fica atrás da porta de notificações; a coluna `canal` do lembrete guarda o canal usado. | `src/grupo3/portas/notificacoes.js` |
| **D-010** | Preenchimento da escala de médicos voluntários | Cadastro manual de cada turno (`POST /api/escalas`), sem recorrência nem integração. A disponibilidade declarada só gera aviso, não cria turnos. | `src/routes/grupo3/escalas.js` |
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
| Tolerância para registrar a realização | 60 min antes do início | `grupo3.tipo_atendimento.tolerancia_realizacao_min`, por tipo (0 a 1440) |
| Antecedência dos lembretes | 24 h (`[1440]`) | Padrão: `grupo3.configuracao`, chave `lembretes.antecedencias_min`. Por tipo: `grupo3.tipo_atendimento.antecedencias_lembrete_min` (`null` usa o padrão; `[]` desliga). Mudar a configuração não altera lembretes já gerados |
| Tentativas de envio | 3 | `grupo3.configuracao`, chave `lembretes.max_tentativas` |
| Intervalo do job | 60 s | Variável `JOBS_INTERVALO_SEG` (mínimo 10); o job só liga com `JOBS_ENABLED=true` |
| Cobertura mínima da escala | Seed de demonstração: clínica médica seg–sex 08–12 h; odontologia ter/qui 13–17 h, 1 profissional | Tabela `grupo3.cobertura_necessaria`, via `PUT /api/escalas/cobertura-necessaria` (`equipe.administrar`) |

## Suposições técnicas

| Tema | Suposição | Onde está |
|---|---|---|
| Idoso ativo | `public.patients` não tem status de inativação; todo idoso cadastrado é tratado como ativo. | `src/grupo3/portas/idosos.js` — `TODO(integracao-G1)` |
| Visibilidade do prontuário (US-031) | Ainda não existe. O G3 exige a permissão clínica do módulo e consulta `podeVerIdoso()`, que hoje libera. | `src/grupo3/portas/prontuario.js` — `TODO(integracao-G1)` |
| LGPD na agenda | Categorias clínicas: `consulta_medica`, `consulta_odontologica`, `avaliacao` (exigem `atendimento-clinico.visualizar`) e `fisioterapia` (exige `fisioterapia.visualizar`). Sem a permissão, o texto livre volta `null`. | `PERMISSAO_CLINICA` em `src/grupo3/regras.js` |
| Realização antes do horário | Aceita a partir da tolerância do tipo (padrão 60 min antes do início); fora dela, 422. | `podeRegistrarRealizacao()` em `src/grupo3/regras.js` |
| Responsável pela realização | Se não for informado, é o profissional do agendamento. O usuário que registrou fica em `registrado_por_ref`, no histórico e na auditoria. | `POST /agendamentos/{id}/realizacao` |
| Correção de realização | Só `agenda.administrar`, com motivo obrigatório; vale para realizado e não realizado. O banco libera a alteração por um ajuste de sessão (`grupo3.correcao_realizacao`) restrito aos campos da realização. | `POST /agendamentos/{id}/corrigir-realizacao`; gatilho `preparar_agendamento` |
| Lembrete sem destinatário | Colaborador sem `usuario_ref` gera lembrete `sem_destinatario`, visível em `GET /agendamentos/{id}/lembretes`, em vez de falha silenciosa. Usuário inativo na hora do envio também resulta em `sem_destinatario`. Ao vincular um usuário ao colaborador, os lembretes futuros `sem_destinatario` voltam para `pendente`. | `gerarLembretes()`, `processarLembretes()` e `reativarLembretesSemDestinatario()` em `src/grupo3/lembretes.js` |
| Destinatário dos lembretes | Só o profissional do agendamento (o usuário da US-074). Familiares e outros perfis dependem da D-008. | `gerarLembretes()` |
| Lembrete atrasado | Antecedências que já passaram ao agendar viram um único envio imediato (a de menor antecedência). Início no passado não gera lembrete. Lembrete pendente de atendimento já iniciado é cancelado pelo job. | `calcularEnvios()` em `src/grupo3/regras.js`; `processarLembretes()` |
| Janela de atendimento | Filtro pela hora de início do agendamento, no fuso da instituição, no intervalo [janelaInicio, janelaFim). Janela que cruza a meia-noite não é aceita. | `filtrosAgendamento()` em `src/grupo3/agenda.js` |
| Responsável na agenda da farmácia | "Responsável" é o profissional do agendamento (`profissionalId`); quem de fato realizou pode ser filtrado por `responsavelRealizacaoId`. | `GET /api/agendas/farmacia` |
| Dados pessoais da equipe | Sem CPF, RG ou documento (não há uso definido). Contatos limitados a e-mail e telefone, visíveis só com `equipe.visualizar`. | `src/routes/grupo3/colaboradores.js`; `mascararContatos()` em `src/grupo3/regras.js` |
| Especialidade | Catálogo `grupo3.especialidade` (nome único, ativo), mantido por `equipe.administrar` em `/api/especialidades`, sem exclusão física. Colaborador, escala e cobertura referenciam por FK; especialidade inexistente ou inativa é 422. Seed: Clínica médica, Odontologia, Fisioterapia, Farmácia, Enfermagem. | `src/routes/grupo3/especialidades.js` |
| Cargo e setor | Opcionais para todos os vínculos; o backlog não define obrigatoriedade. | `POST /api/colaboradores` |
| Escala x presença | Tabelas separadas: escala = planejado, presença = o que aconteceu. Presença pode apontar para o turno previsto (uma por escala). Cancelar a escala não apaga a presença. | `grupo3.escala`, `grupo3.presenca` |
| Turno noturno | Escala e presença guardam instantes em `timestamptz`; plantão 19h–07h é um registro só (até 24 h). Disponibilidade e cobertura continuam por dia da semana em horário local, com `24:00` como fim do dia: as noturnas são declaradas em dois dias. | `grupo3.escala`, `grupo3.presenca`; `segmentosDoTurno()` e `recortarNoDia()` em `src/grupo3/regras.js` |
| Turno fora da disponibilidade | Aceito, com aviso `fora_da_disponibilidade` na resposta. Sem disponibilidade declarada, nenhum aviso. | `dentroDaDisponibilidade()` |
| Presença | **Registro operacional, não substitui o controle de ponto.** Só para hoje ou datas passadas, de colaborador ativo. Uma presença em aberto (sem saída) por colaborador, em qualquer data (o plantão noturno fica aberto na virada do dia). A justificativa da ausência é opcional. Registro só pela gestão (`equipe.criar`); leitura com `equipe.visualizar`. | `src/routes/grupo3/presencas.js` |
| Escala cancelada | Motivo opcional, guardado em `motivo_cancelamento`. Situação `cancelada` é final. | `PATCH /api/escalas/{id}/situacao` |
| Leitura de escalas e lacunas | Também para quem tem `agenda.visualizar` ou `atendimento-clinico.visualizar` (saber quem está escalado), sem contatos. | `VER` em `src/routes/grupo3/escalas.js` |
| Formato de erro | Mantido o do repositório, `{ error: { message, details } }`, e não ProblemDetails. | `src/middleware/error.js` |
| Base dos paths | `/api`, sem `/v1`, como o resto da API. | `src/routes/grupo3/index.js` |
| Migrations | O repositório não tem migrations incrementais: `db:setup` recria o banco a partir de `sql/*.sql`. O schema do G3 é `sql/grupo3.sql`. Migração incremental é decisão da Fundação. | `src/db/reset.js` |
| Agenda legada | `/api/agenda`, `/api/atendimentos` e `/api/funcionarios` ficam intactas e marcadas como obsoletas no OpenAPI. Não há migração de dados de `agenda_events` e `appointments`. | `src/docs/openapi.js` |
| Auditoria de negação | Respostas 403 não são auditadas pelo G3 (cabe à Fundação). Recusas por conflito de agenda são auditadas. | `auditarRecusa()` em `src/routes/grupo3/agendamentos.js` |
