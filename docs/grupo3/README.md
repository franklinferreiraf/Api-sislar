# Grupo 3 — Agenda, atendimentos e profissionais

Backend dos épicos E07 (agenda, cuidados e atendimentos), E08 (fisioterapia), E09 (atendimento médico e odontológico) e E10 parcial (US-091 a US-096).

| Fatia | Escopo | Situação |
|---|---|---|
| 1 | `Colaborador` mínimo, US-065, US-066, US-067, US-068, US-069, US-072, US-073 | **Entregue** |
| 2 | US-070, US-071, US-074 (lembretes + job) | **Entregue** |
| 3 | US-091, US-092, US-082, US-083, US-084, US-093 | A fazer |
| 4 | US-085 a US-089 | A fazer |
| 5 | US-075 a US-080 | A fazer |
| 6 | US-094 a US-096 + indicadores para o Grupo 5 | A fazer |
| 7 | US-081, US-090 (P2) | A fazer |

As suposições e as decisões pendentes estão em [decisoes-pendentes.md](decisoes-pendentes.md).

## Rodar os testes com o banco em outra porta

`npm test` recria o banco `sislar_test` no servidor apontado por `DATABASE_URL`; com `NODE_ENV=test`, `src/config.js` troca o nome do banco para `sislar_test`. Se a porta 5432 já estiver ocupada por outro Postgres, suba um container só para os testes em outra porta:

```bash
docker run -d --name sislar-check-pg   -e POSTGRES_USER=sislar -e POSTGRES_PASSWORD=sislar -e POSTGRES_DB=sislar   -p 55433:5432 postgres:16-alpine
```

Depois rode os testes apontando para essa porta.

Bash / Git Bash:

```bash
DATABASE_URL=postgres://sislar:sislar@localhost:55433/sislar npm test
```

PowerShell:

```powershell
$env:DATABASE_URL = "postgres://sislar:sislar@localhost:55433/sislar"; npm test
```

Também dá para gravar `DATABASE_URL` no `.env`; uma variável já definida no ambiente tem prioridade sobre ele. No Windows, pare antes qualquer `node src/server.js` em execução: o servidor segura a DLL do Prisma e o `prisma generate` do `npm test` falha com `EPERM`. Para remover o container no fim: `docker rm -f sislar-check-pg`.

## Onde fica cada coisa

| Caminho | Conteúdo |
|---|---|
| `sql/grupo3.sql` | Schema `grupo3`: tabelas, constraints, índices e gatilhos (carregado por `src/db/reset.js`) |
| `src/grupo3/regras.js` | Regras puras: conflito, transições, motivo, LGPD |
| `src/grupo3/agenda.js` | Consultas da agenda, conflito com lock por profissional, histórico |
| `src/grupo3/validacao.js` | Esquemas zod compartilhados |
| `src/grupo3/portas/` | Portas de integração (`idosos.js`, `prontuario.js`, `notificacoes.js`) |
| `src/grupo3/lembretes.js` | Geração, cancelamento e envio dos lembretes (US-074) |
| `src/grupo3/jobs.js` | Agendador dos jobs (`JOBS_ENABLED=true`), chamado por `src/server.js` |
| `src/routes/grupo3/` | Rotas, montadas em `/api` por `index.js` |
| `src/docs/openapi.grupo3.js` | OpenAPI do G3, juntado em `src/docs/openapi.js` |
| `src/db/seedGrupo3.js` | Dados de demonstração |
| `tests/grupo3.rules.test.js`, `tests/grupo3.api.test.js` | Testes unitários, de integração e de permissão |

Segue a stack e as convenções do repositório: Express, SQL puro via Prisma (`$queryRaw`), zod, `node:test` + supertest com banco real (`sislar_test`), erro no formato `{ "error": { "message", "details" } }`.

## Modelo de dados (Fatia 1)

Idoso e usuário entram como UUID (`patients.ref`, `users.ref`), no mesmo padrão do Grupo 2, sem FK entre schemas. A API valida esses UUIDs pela porta de integração.

```mermaid
erDiagram
    COLABORADOR ||--o{ AGENDAMENTO : "profissional"
    COLABORADOR ||--o{ AGENDAMENTO : "responsável pela realização"
    TIPO_ATENDIMENTO ||--o{ AGENDAMENTO : "tipo"
    AGENDAMENTO ||--o{ HISTORICO_AGENDAMENTO : "trilha"
    AGENDAMENTO ||--o{ LEMBRETE_AGENDAMENTO : "lembretes"
    COLABORADOR ||--o{ LEMBRETE_AGENDAMENTO : "destinatário"
    USERS_public ||--o| COLABORADOR : "usuario_ref (opcional)"
    PATIENTS_public ||--o{ AGENDAMENTO : "idoso_ref"

    COLABORADOR {
        uuid id PK
        text nome
        enum vinculo "funcionario | voluntario | externo"
        enum status "ativo | inativo"
        uuid usuario_ref UK "users.ref, opcional"
    }
    TIPO_ATENDIMENTO {
        uuid id PK
        text nome UK "único sem diferenciar maiúsculas"
        enum categoria "consulta_medica | consulta_odontologica | fisioterapia | cuidado_pessoal | farmacia | avaliacao | outro"
        int duracao_padrao_min "5 a 720"
        bool exige_motivo_cancelamento
        bool exige_motivo_reagendamento
        bool permite_sobreposicao
        int tolerancia_realizacao_min "padrão 60"
        int_array antecedencias_lembrete_min "null = padrão; [] = sem lembrete"
        bool ativo
    }
    AGENDAMENTO {
        uuid id PK
        uuid idoso_ref "patients.ref"
        uuid tipo_id FK
        uuid profissional_id FK
        timestamptz inicio
        int duracao_min "5 a 720"
        timestamptz fim "gatilho: inicio + duracao"
        text local
        text observacoes
        enum status "agendado | realizado | nao_realizado | cancelado"
        text motivo_status
        uuid responsavel_realizacao_id FK
        text observacao_realizacao
        uuid registrado_por_ref "users.ref de quem registrou"
        timestamptz concluido_em
        uuid criado_por_ref "users.ref"
    }
    HISTORICO_AGENDAMENTO {
        uuid id PK
        uuid agendamento_id FK
        text acao "criado | reagendado | cancelado | realizado | nao_realizado | corrigido"
        jsonb anterior
        jsonb novo
        text motivo
        uuid autor_ref "users.ref"
        timestamptz em
    }
    LEMBRETE_AGENDAMENTO {
        uuid id PK
        uuid agendamento_id FK
        uuid colaborador_id FK
        uuid usuario_ref "users.ref do destinatário"
        int antecedencia_min
        timestamptz enviar_em
        text canal "interno"
        enum status "pendente | enviado | entregue | falha | sem_destinatario | cancelado"
        int tentativas
        text ultimo_erro
        text notificacao_id "public.notifications.id"
        timestamptz enviado_em
        timestamptz entregue_em
    }
```

Integridade garantida no banco:

- `fim` é preenchido pelo gatilho `preparar_agendamento`, com `CHECK (fim > inicio)`. Não é coluna gerada porque `timestamptz + interval` é STABLE.
- Agendamento encerrado (realizado, não realizado ou cancelado) não pode ser alterado.
- Agendamento, tipo e colaborador não aceitam `DELETE`: o caminho é cancelar ou inativar.
- `historico_agendamento` não aceita `UPDATE` nem `DELETE`.
- Exceção única à imutabilidade: `POST /agendamentos/{id}/corrigir-realizacao` liga `grupo3.correcao_realizacao` com `set_config(..., true)`, que vale só na transação corrente (equivale a `SET LOCAL`) e some no commit ou rollback. Com isso, o gatilho aceita trocar só status (entre realizado e não realizado), responsável e observação da realização.
- `CHECK`: status diferente de `agendado` ⇔ `concluido_em` e `registrado_por_ref` preenchidos. Realizado ou não realizado exige responsável.
- Índice parcial `(profissional_id, inicio) WHERE status = 'agendado'` para a checagem de conflito.

## Regras de negócio

**Conflito (US-073).** Há conflito quando o mesmo profissional tem outro agendamento `agendado` cujo intervalo `[inicio, fim)` se sobrepõe ao novo. Encostar no fim do anterior não é conflito. Cancelado, realizado e não realizado não conflitam. A sobreposição só é permitida quando o novo e o existente são do **mesmo tipo** e esse tipo tem `permite_sobreposicao = true`; qualquer outra combinação é conflito. A checagem roda dentro da transação, depois de um `pg_advisory_xact_lock` por profissional, então duas gravações simultâneas no mesmo horário não passam juntas. No reagendamento, a checagem ignora o próprio agendamento. Conflito responde `409` com `error.details.conflitos`. `POST /api/agendamentos/verificar-conflitos` faz a mesma checagem sem gravar.

**Status (US-068, US-069).** `agendado → realizado | nao_realizado | cancelado`. Reagendar mantém o mesmo registro e grava `anterior → novo` no histórico. O motivo é obrigatório conforme a configuração do tipo. A realização pode ser registrada a partir de `tolerancia_realizacao_min` minutos antes do início (configurável por tipo, padrão 60); antes disso a resposta é 422. O responsável padrão é o profissional do agendamento, e quem registrou fica em `registrado_por_ref` (`registradoPor` na API), no histórico e na auditoria. Para corrigir uma realização já registrada, use `corrigir-realizacao` (só `agenda.administrar`, motivo obrigatório); a correção entra no histórico como `corrigido`.

**Agenda (US-066).** Dia, semana (segunda a domingo) ou mês, calculados no fuso da instituição (`grupo3.configuracao.fuso_horario`, padrão `America/Sao_Paulo`). Cada item traz `status` e `emConflito`; o `resumo` conta os itens por status e os em conflito.

**Agenda da farmácia e de cuidados pessoais (US-070, US-071).** São a mesma agenda única, filtrada pela categoria do tipo (`farmacia` e `cuidado_pessoal`). `GET /api/agendas/farmacia` e `GET /api/agendas/cuidados-pessoais` mostram o período (dia, semana ou mês) com filtro por responsável (`profissionalId`, `responsavelRealizacaoId`) e por janela de atendimento (`janelaInicio`/`janelaFim`, HH:MM no fuso da instituição, aplicada à hora de início). Os mesmos filtros valem em `GET /api/agendamentos`. `GET /api/idosos/{idosoId}/cuidados-pessoais` resume, por serviço, a última realização (com responsável), o próximo agendamento e o total realizado.

**Lembretes (US-074).** Ao agendar, o G3 cria um lembrete para o profissional em cada antecedência configurada: no tipo (`antecedencias_lembrete_min`) ou, se o tipo não define, no padrão da instituição (`grupo3.configuracao`, `lembretes.antecedencias_min`, 24 h). Antecedências que já passaram viram um único envio imediato; agendamento com início no passado não gera lembrete, nem o imediato. Se o job encontrar um lembrete pendente cujo atendimento já começou (ex.: job parado), ele é cancelado com `ultimoErro` em vez de enviado. Se o colaborador não tem usuário vinculado, o lembrete nasce como `sem_destinatario`; quando o usuário é vinculado, só os lembretes de agendamentos ainda `agendado` e com início no futuro voltam para `pendente`. Reagendar, inclusive com troca de profissional, cancela os lembretes pendentes e gera novos para o profissional atual; o reagendamento é o único caminho que troca o profissional de um agendamento. Cancelar ou registrar a realização cancela os pendentes. O job `processarLembretes` (a cada `JOBS_INTERVALO_SEG`, com `JOBS_ENABLED=true`) envia os vencidos pela porta de notificações, com `FOR UPDATE SKIP LOCKED`: o canal interno grava em `public.notifications` e marca `entregue`. Uma falha volta para a fila até `lembretes.max_tentativas` (3) e então vira `falha`, com o erro em `ultimoErro`. A mensagem leva tipo, idoso, data/hora e local, sem observações clínicas.

**LGPD.** Nas categorias clínicas (consultas, avaliação e fisioterapia), `observacoes`, `motivoStatus` e `observacaoRealizacao` voltam `null`, com `conteudoRestrito: true`, para quem não tem `atendimento-clinico.visualizar` (consultas e avaliação) ou `fisioterapia.visualizar`. A exceção é o próprio profissional do agendamento. A trilha de histórico aplica a mesma regra.

## Endpoints (Fatia 1)

A documentação completa, com exemplos e erros, está em `/api/docs`.

| Método e rota | Permissão | US |
|---|---|---|
| `GET /api/tipos-atendimento` | `agenda.visualizar` | 065 |
| `GET /api/tipos-atendimento/{id}` | `agenda.visualizar` | 065 |
| `POST /api/tipos-atendimento` | `agenda.administrar` | 065 |
| `PUT /api/tipos-atendimento/{id}` | `agenda.administrar` | 065 |
| `PATCH /api/tipos-atendimento/{id}/status` | `agenda.administrar` | 065 |
| `GET /api/colaboradores` · `GET /api/colaboradores/{id}` | `equipe.visualizar`, `agenda.criar` ou `agenda.editar` | — |
| `POST /api/colaboradores` | `equipe.criar` | — |
| `PUT /api/colaboradores/{id}` | `equipe.editar` | — |
| `PATCH /api/colaboradores/{id}/status` | `equipe.excluir` | — |
| `GET /api/agendamentos` | `agenda.visualizar` | 066 |
| `POST /api/agendamentos/verificar-conflitos` | `agenda.criar` ou `agenda.editar` | 073 |
| `POST /api/agendamentos` | `agenda.criar` | 067, 073 |
| `GET /api/agendamentos/{id}` | `agenda.visualizar` ou ser o profissional | 067 |
| `POST /api/agendamentos/{id}/reagendar` | `agenda.editar` | 068, 073 |
| `POST /api/agendamentos/{id}/cancelar` | `agenda.editar` | 068 |
| `POST /api/agendamentos/{id}/realizacao` | `agenda.editar` | 069 |
| `POST /api/agendamentos/{id}/corrigir-realizacao` | `agenda.administrar` | 069 |
| `GET /api/agendamentos/{id}/historico` | `agenda.visualizar` ou ser o profissional | 068 |
| `GET /api/colaboradores/{id}/agenda?visao=dia\|semana\|mes&data=` | `agenda.visualizar` | 066 |
| `GET /api/me/agenda?visao=&data=` | sessão autenticada | 066 |
| `GET /api/idosos/{idosoId}/atendimentos` | `agenda.visualizar` | 072 |
| `GET /api/agendas/farmacia?visao=&data=&profissionalId=&janelaInicio=&janelaFim=` | `agenda.visualizar` | 070 |
| `GET /api/agendas/cuidados-pessoais?visao=&data=&profissionalId=&janelaInicio=&janelaFim=` | `agenda.visualizar` | 071 |
| `GET /api/idosos/{idosoId}/cuidados-pessoais` | `agenda.visualizar` | 071 |
| `GET /api/agendamentos/{id}/lembretes` | `agenda.visualizar` ou ser o profissional | 074 |

Listagens: `page` e `limit` (máx. 100), resposta `{ data, meta }`. Datas com hora em ISO 8601 com fuso (`2026-11-10T14:00:00-03:00`); o banco grava em UTC. `idosoId` é o mesmo id usado no prontuário (ex.: `p02`).

### Rotas legadas (obsoletas)

`GET/POST /api/agenda` (tabela `agenda_events`), `GET/POST /api/atendimentos` (tabela `appointments`) e `GET /api/funcionarios` são do protótipo. Continuam funcionando sem alteração, mas estão marcadas como `deprecated` no OpenAPI. Use `/api/agendamentos`, `/api/idosos/{idosoId}/atendimentos` e `/api/colaboradores`.

## Matriz de permissões

Códigos `<modulo>.<acao>`, adicionados em `src/lib/permissions.js` (arquivo da Fundação, em commit separado). Os códigos `modulo.*` existentes não mudaram. O perfil `admin` tem todos.

| Perfil | agenda | fisioterapia | atendimento-clinico | equipe | tarefas |
|---|---|---|---|---|---|
| gestor | visualizar, criar, editar, excluir, administrar | visualizar, administrar | visualizar, administrar | todas | visualizar, criar, editar, administrar |
| enfermagem | visualizar, criar, editar | visualizar | visualizar | visualizar | visualizar, criar, editar |
| técnico | visualizar | — | — | — | visualizar, editar |
| médico | visualizar, criar, editar | visualizar | visualizar, criar, editar | — | visualizar, editar |
| fisioterapia | visualizar, criar, editar | visualizar, criar, editar | — | — | visualizar, editar |
| odontologia | visualizar, criar, editar | — | visualizar, criar, editar | — | visualizar, editar |
| farmácia | visualizar, criar, editar | — | — | — | visualizar, editar |
| recepção | visualizar, criar, editar | — | — | — | visualizar, editar |
| estoque | — | — | — | — | visualizar, editar |
| voluntário | **só `/api/me/agenda`** | — | — | — | visualizar, editar |

- Cancelar e reagendar exigem `agenda.editar`.
- `excluir` significa inativar (tipos e colaboradores); não existe exclusão física.
- A partir da Fatia 6, `tarefas.editar` só vale para tarefas em que o usuário é o responsável, salvo `tarefas.administrar`.

## Auditoria

Usa a auditoria da Fundação (`public.audit_log`, via `audit()` em `src/db/helpers.js`), que já grava autor, data/hora, ação, entidade e identificador. O resultado vai em `payload.resultado` (`sucesso` ou `recusado_conflito`). O payload não leva texto clínico livre.

| Ação | Quando |
|---|---|
| `tipo_atendimento.criar` · `editar` · `ativar` · `inativar` | Alterações em tipos |
| `colaborador.criar` · `editar` · `ativar` · `inativar` | Alterações em colaboradores |
| `agendamento.criar` · `reagendar` · `cancelar` · `realizado` · `nao_realizado` · `corrigir_realizacao` | Alterações em agendamentos; criar e reagendar também registram recusas por conflito |

## Contratos de integração

| Porta | Arquivo | Situação | Contrato |
|---|---|---|---|
| Idosos (G1, US-011) | `src/grupo3/portas/idosos.js` | Adaptador real sobre `public.patients` | `buscarIdoso(idosoId) → { id, ref, nome, ativo } \| null`; `buscarIdososPorRef(refs) → Map<ref, idoso>`. `ativo` é sempre `true`: `TODO(integracao-G1)` |
| Prontuário — visibilidade (G1, US-031) | `src/grupo3/portas/prontuario.js` | Stub `TODO(integracao-G1)` | `podeVerIdoso(usuario, idoso) → boolean`, chamado no histórico do idoso |
| Prontuário — linha do tempo (G1, US-023/US-030) | `src/grupo3/portas/prontuario.js` | Stub `TODO(integracao-G1)`; uso a partir da Fatia 4 | `publicarNoProntuario({ idosoRef, origem: "grupo3", tipo, referenciaId, ocorridoEm, profissional, resumo }) → { status }` |
| Notificações (G4, US-117) | `src/grupo3/portas/notificacoes.js` | Adaptador real do canal interno sobre `public.notifications`; `TODO(integracao-G4)` para o serviço do Grupo 4 | `enviarNotificacao({ usuarioId, titulo, corpo, link }, db) → { status: "enviado" \| "entregue", canal, referencia }`. Exceção = falha (o job tenta de novo) |
| Jobs (T-008) | `src/grupo3/jobs.js` | Agendador no processo, ligado por `JOBS_ENABLED=true` | `iniciarJobs({ intervaloSeg, jobs })` e `pararJobs()` (chamado no `SIGTERM`/`SIGINT` de `src/server.js`). Cada rodada tem try/catch com log sem dados sensíveis; se a anterior de um job ainda está rodando, a nova é pulada. `processarLembretes({ agora, limite, enviar })` também pode ser chamado direto |
| Indicadores (G5) | — | Fatia 6 | `GET /api/indicadores/atendimentos \| tarefas \| equipe` |
