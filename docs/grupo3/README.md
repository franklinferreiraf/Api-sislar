# Grupo 3 — Agenda, atendimentos e profissionais

Backend dos épicos E07 (agenda, cuidados e atendimentos), E08 (fisioterapia), E09 (atendimento médico e odontológico) e E10 parcial (US-091 a US-096).

| Fatia | Escopo | Situação |
|---|---|---|
| 1 | `Colaborador` mínimo, US-065, US-066, US-067, US-068, US-069, US-072, US-073 | **Entregue** |
| 2 | US-070, US-071, US-074 (lembretes + job) | **Entregue** |
| 3 | US-091, US-092, US-082, US-083, US-084, US-093 | **Entregue** |
| 4 | US-085 a US-089 | **Entregue** |
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
| `src/grupo3/auditoria.js` | Auditoria de leitura de dados clínicos |
| `src/routes/grupo3/` | Rotas, montadas em `/api` por `index.js` (`agendamentos`, `tipos-atendimento`, `colaboradores`, `especialidades`, `escalas`, `presencas`, `clinico`) |
| `src/docs/openapi.grupo3.js` | OpenAPI do G3, juntado em `src/docs/openapi.js` |
| `src/db/seedGrupo3.js` | Dados de demonstração |
| `tests/grupo3.rules.test.js`, `tests/grupo3.api.test.js` | Testes unitários, de integração e de permissão |

Segue a stack e as convenções do repositório: Express, SQL puro via Prisma (`$queryRaw`), zod, `node:test` + supertest com banco real (`sislar_test`), erro no formato `{ "error": { "message", "details" } }`.

## Modelo de dados

Idoso e usuário entram como UUID (`patients.ref`, `users.ref`), no mesmo padrão do Grupo 2, sem FK entre schemas. A API valida esses UUIDs pela porta de integração.

```mermaid
erDiagram
    COLABORADOR ||--o{ AGENDAMENTO : "profissional"
    COLABORADOR ||--o{ AGENDAMENTO : "responsável pela realização"
    TIPO_ATENDIMENTO ||--o{ AGENDAMENTO : "tipo"
    AGENDAMENTO ||--o{ HISTORICO_AGENDAMENTO : "trilha"
    AGENDAMENTO ||--o{ LEMBRETE_AGENDAMENTO : "lembretes"
    COLABORADOR ||--o{ LEMBRETE_AGENDAMENTO : "destinatário"
    ESPECIALIDADE ||--o{ COLABORADOR : "especialidade"
    ESPECIALIDADE ||--o{ ESCALA : "área do turno"
    ESPECIALIDADE ||--o{ COBERTURA_NECESSARIA : "necessidade"
    COLABORADOR ||--o{ DISPONIBILIDADE_COLABORADOR : "declara"
    COLABORADOR ||--o{ ESCALA : "planejado"
    COLABORADOR ||--o{ PRESENCA : "aconteceu"
    ESCALA |o--o| PRESENCA : "turno previsto (opcional)"
    AGENDAMENTO |o--o{ REGISTRO_CLINICO : "consulta"
    REGISTRO_CLINICO |o--o{ REGISTRO_CLINICO : "adendos"
    ACOMPANHAMENTO_ODONTOLOGICO |o--o{ REGISTRO_CLINICO : "registros"
    AGENDAMENTO |o--o{ TRATAMENTO_EXTERNO : "opcional"
    PATIENTS_public ||--o{ TRATAMENTO_EXTERNO : "idoso_ref"
    PATIENTS_public ||--o{ ACOMPANHAMENTO_ODONTOLOGICO : "idoso_ref"
    USERS_public ||--o| COLABORADOR : "usuario_ref (opcional)"
    PATIENTS_public ||--o{ AGENDAMENTO : "idoso_ref"

    COLABORADOR {
        uuid id PK
        text nome
        enum vinculo "funcionario | voluntario | externo"
        enum status "ativo | inativo"
        text cargo
        text setor
        uuid especialidade_id FK
        text registro_profissional
        text email "só com equipe.visualizar"
        text telefone "só com equipe.visualizar"
        uuid usuario_ref UK "users.ref, opcional"
    }
    ESPECIALIDADE {
        uuid id PK
        text nome UK
        bool ativo
    }
    DISPONIBILIDADE_COLABORADOR {
        uuid id PK
        uuid colaborador_id FK
        smallint dia_semana "ISO 1 a 7"
        time hora_inicio
        time hora_fim "aceita 24:00"
    }
    ESCALA {
        uuid id PK
        uuid colaborador_id FK
        uuid especialidade_id FK
        text local
        timestamptz inicio
        timestamptz fim "até 24 h depois; 19h-07h é um registro"
        enum situacao "prevista | confirmada | cancelada"
        text motivo_cancelamento
    }
    COBERTURA_NECESSARIA {
        uuid id PK
        uuid especialidade_id FK
        smallint dia_semana
        time hora_inicio
        time hora_fim
        smallint quantidade_minima
    }
    PRESENCA {
        uuid id PK
        uuid colaborador_id FK
        uuid escala_id FK "opcional, única"
        date data
        enum situacao "presente | ausente"
        timestamptz entrada_em
        timestamptz saida_em
        text atividade
        text justificativa
        uuid registrado_por_ref
    }
    REGISTRO_CLINICO {
        uuid id PK
        uuid agendamento_id FK "um principal por consulta"
        uuid adendo_de FK "correção por adendo"
        uuid acompanhamento_id FK
        uuid idoso_ref
        enum area "medica | odontologica"
        uuid profissional_id FK
        text tipo
        timestamptz realizado_em
        text resumo
        jsonb conteudo "flexível, até 20 KB"
        enum status "rascunho | finalizado"
        uuid autor_ref
        uuid finalizado_por_ref
        text publicacao_status "publicado | pendente_integracao | falha"
        text prontuario_ref "public.evolutions.id"
    }
    ACOMPANHAMENTO_ODONTOLOGICO {
        uuid id PK
        uuid idoso_ref "um ativo por idoso"
        uuid responsavel_id FK
        text plano
        int periodicidade_dias
        date proxima_avaliacao
        enum situacao "em_tratamento | em_acompanhamento | concluido | suspenso"
    }
    TRATAMENTO_EXTERNO {
        uuid id PK
        uuid idoso_ref
        uuid agendamento_id FK "opcional"
        enum area "medica | odontologica | outra"
        text tipo
        text local_externo
        date data
        text profissional_nome
        text instituicao
        text observacoes
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

**Equipe (US-082, US-091, US-092).** Cadastro único de colaboradores: vínculo (`funcionario`, `voluntario`, `externo`), cargo, setor, status, especialidade (FK para o catálogo `grupo3.especialidade`, mantido por quem tem `equipe.administrar` em `/api/especialidades`, sem exclusão física), registro profissional, contatos (e-mail e telefone) e usuário do sistema opcional. Não há CPF nem documento, porque não há uso definido para eles. Contatos só aparecem para quem tem `equipe.visualizar`; os demais recebem `email` e `telefone` como `null`, com `contatosRestritos: true`. A disponibilidade semanal é declarada por dia ISO (1 = segunda), no relógio da instituição, e substituída inteira por `PUT`; `24:00` marca o fim do dia, e disponibilidade noturna é declarada em dois dias.

**Escala x presença (US-083, US-093).** São tabelas separadas. A **escala** é o planejado: colaborador, especialidade, local, início e fim (`timestamptz`) e situação (`prevista`, `confirmada`, `cancelada`). A API recebe data + horários no fuso da instituição; `horaFim` menor ou igual a `horaInicio` termina no dia seguinte, então o plantão 19h–07h é **um registro só** (até 24 h). O mesmo colaborador não pode ter turnos sobrepostos não cancelados, inclusive dos dois lados da meia-noite (lock por colaborador + restrição de exclusão `btree_gist` sobre `tstzrange(inicio, fim)`). Turno fora da disponibilidade declarada (conferida trecho a trecho no fuso da instituição) é aceito com aviso em `avisos`. A **presença** é o que aconteceu: entrada/saída (`timestamptz`; saída antes da entrada = dia seguinte) ou ausência com justificativa, opcionalmente ligada ao turno previsto (uma presença por escala, mesmo colaborador e mesma data de início). Cancelar uma escala não apaga a presença registrada. Presença só para hoje ou passado.

> **A presença (US-093) é registro operacional de quem está trabalhando. Ela não substitui o controle de ponto**: não tem as garantias legais de um sistema de ponto (marcação pelo próprio trabalhador, inalterabilidade, espelho de ponto) e não deve ser usada para folha de pagamento ou jornada.

**Lacunas (US-084).** A cobertura mínima (`cobertura_necessaria`) é configurada por especialidade (FK), dia da semana e faixa horária (`24:00` = fim do dia; necessidade noturna em duas faixas). `GET /api/escalas/lacunas` cruza essa necessidade com as escalas `prevista`/`confirmada` de colaboradores ativos da mesma especialidade, recortando cada turno nos dias que ele toca (um plantão 19h–05h conta na noite do primeiro dia e na madrugada do segundo), e devolve os trechos abaixo do mínimo, com quantos estão escalados e quantos faltam.

**Consultas (US-085).** Consulta é um agendamento cujo tipo tem categoria `consulta_medica` ou `consulta_odontologica`. O `local` é obrigatório. Se o profissional não estiver numa escala não cancelada cobrindo todo o horário, o agendamento é aceito com o aviso `fora_da_escala` em `avisos`, sem bloquear. O mesmo aviso aparece no reagendamento e na verificação de conflitos.

**Registro clínico (US-086, US-087).** Resultado da consulta com campos mínimos (profissional, data/hora, tipo, resumo) e `conteudo` flexível em jsonb, validado. Status `rascunho → finalizado`. O rascunho é editado só pelo autor (ou por `atendimento-clinico.administrar`). Finalizar exige a consulta realizada. **Finalizado não aceita edição** (gatilho no banco); a correção é um **adendo**: registro novo, finalizado, vinculado por `adendo_de`, com autor e data. Ao finalizar, o registro (e cada adendo) é publicado no prontuário do idoso como evolução finalizada, **se quem finaliza tem `evolucao.create`** (permissão do Grupo 1, não contornada). Sem ela, o registro é finalizado no G3 com `publicacao.status = "aguardando_permissao"`; `POST /api/registros-clinicos/republicar-pendentes` publica depois, em nome de quem finalizou, quando a permissão for concedida. Registro odontológico pode apontar para o acompanhamento odontológico do mesmo idoso.

**Acompanhamento odontológico (US-087).** Plano, periodicidade, próxima avaliação, responsável e situação (`em_tratamento`, `em_acompanhamento`, `concluido`, `suspenso`). Cada idoso tem no máximo um acompanhamento ativo.

**Tratamento externo (US-088).** Ligado ao idoso, com agendamento opcional (do mesmo idoso): área, tipo, local externo, data (hoje ou passado), profissional e instituição quando informados, e observações.

**Ciclo odontológico (US-089).** `GET /api/odontologia/pendencias` lista os idosos sem registro odontológico no ciclo: registro clínico odontológico finalizado ou tratamento externo odontológico. O modo é configurável (`grupo3.configuracao`, chave `odontologia.ciclo`): `semestre_civil` (padrão; `?ciclo=AAAA-S`, jan–jun = 1, jul–dez = 2) ou `dias_corridos` (janela de N dias até `?referencia=`).

**Auditoria de leitura.** Ler registro clínico, acompanhamento odontológico, tratamento externo e pendências grava `<entidade>.ler` no `audit_log`, com quem acessou (`user_id`), quando (`at`), quais idosos (`payload.idosos`), quais registros e a rota.

**LGPD.** Nas categorias clínicas (consultas, avaliação e fisioterapia), `observacoes`, `motivoStatus` e `observacaoRealizacao` voltam `null`, com `conteudoRestrito: true`, para quem não tem `atendimento-clinico.visualizar` (consultas e avaliação) ou `fisioterapia.visualizar`. A exceção é o próprio profissional do agendamento. A trilha de histórico aplica a mesma regra.

## Endpoints

A documentação completa, com exemplos e erros, está em `/api/docs`.

| Método e rota | Permissão | US |
|---|---|---|
| `GET /api/tipos-atendimento` | `agenda.visualizar` | 065 |
| `GET /api/tipos-atendimento/{id}` | `agenda.visualizar` | 065 |
| `POST /api/tipos-atendimento` | `agenda.administrar` | 065 |
| `PUT /api/tipos-atendimento/{id}` | `agenda.administrar` | 065 |
| `PATCH /api/tipos-atendimento/{id}/status` | `agenda.administrar` | 065 |
| `GET /api/colaboradores?vinculo&status&setor&especialidadeId&q` · `GET /api/colaboradores/{id}` | `equipe.visualizar`, `agenda.criar` ou `agenda.editar` (contatos só com `equipe.visualizar`) | 082, 091, 092 |
| `POST /api/colaboradores` | `equipe.criar` | 082, 091, 092 |
| `PUT /api/colaboradores/{id}` | `equipe.editar` | 082, 091, 092 |
| `PATCH /api/colaboradores/{id}/status` | `equipe.excluir` | 091, 092 |
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
| `POST /api/agendamentos/{id}/registro-clinico` | `atendimento-clinico.criar` | 086, 087 |
| `GET /api/agendamentos/{id}/registro-clinico` · `GET /api/registros-clinicos/{id}` | `atendimento-clinico.visualizar` (leitura auditada) | 086 |
| `PUT /api/registros-clinicos/{id}` · `POST /api/registros-clinicos/{id}/finalizar` | `atendimento-clinico.editar` (autor ou administrar) | 086 |
| `POST /api/registros-clinicos/{id}/adendos` | `atendimento-clinico.criar` | 086 |
| `POST /api/registros-clinicos/republicar-pendentes` | `atendimento-clinico.administrar` | 086 |
| `GET /api/idosos/{idosoId}/registros-clinicos` | `atendimento-clinico.visualizar` (leitura auditada) | 086, 072 |
| `GET /api/odontologia/acompanhamentos` · `GET /api/odontologia/acompanhamentos/{id}` | `atendimento-clinico.visualizar` (leitura auditada) | 087 |
| `POST /api/odontologia/acompanhamentos` | `atendimento-clinico.criar` | 087 |
| `PUT /api/odontologia/acompanhamentos/{id}` | `atendimento-clinico.editar` | 087 |
| `GET /api/tratamentos-externos` · `GET /api/tratamentos-externos/{id}` | `atendimento-clinico.visualizar` (leitura auditada) | 088 |
| `POST /api/tratamentos-externos` | `atendimento-clinico.criar` | 088 |
| `PUT /api/tratamentos-externos/{id}` | `atendimento-clinico.editar` | 088 |
| `GET /api/odontologia/pendencias?ciclo=AAAA-S&referencia=` | `atendimento-clinico.visualizar` (leitura auditada) | 089 |
| `GET /api/odontologia/configuracao-ciclo` | `atendimento-clinico.visualizar` | 089 |
| `PUT /api/odontologia/configuracao-ciclo` | `atendimento-clinico.administrar` | 089 |
| `GET /api/especialidades` · `GET /api/especialidades/{id}` | `equipe.visualizar`, `equipe.administrar`, `agenda.visualizar`, `agenda.criar` ou `atendimento-clinico.visualizar` | 082, 084 |
| `POST /api/especialidades` · `PUT /api/especialidades/{id}` · `PATCH /api/especialidades/{id}/status` | `equipe.administrar` | 082, 084 |
| `GET /api/colaboradores/{id}/disponibilidades` | `equipe.visualizar`, `agenda.criar` ou `agenda.editar` | 082, 092 |
| `PUT /api/colaboradores/{id}/disponibilidades` | `equipe.editar` | 082, 092 |
| `GET /api/escalas?inicio&fim&colaboradorId&especialidadeId&situacao&local` | `equipe.visualizar`, `agenda.visualizar` ou `atendimento-clinico.visualizar` | 083 |
| `GET /api/escalas/{id}` | idem | 083 |
| `POST /api/escalas` | `equipe.criar` | 083 |
| `PUT /api/escalas/{id}` | `equipe.editar` | 083 |
| `PATCH /api/escalas/{id}/situacao` | `equipe.editar` | 083 |
| `GET /api/escalas/cobertura-necessaria` | `equipe.visualizar`, `agenda.visualizar` ou `atendimento-clinico.visualizar` | 084 |
| `PUT /api/escalas/cobertura-necessaria` | `equipe.administrar` | 084 |
| `GET /api/escalas/lacunas?inicio&fim&especialidadeId` | `equipe.visualizar`, `agenda.visualizar` ou `atendimento-clinico.visualizar` | 084 |
| `GET /api/presencas?data&inicio&fim&colaboradorId&vinculo&situacao&emAndamento` | `equipe.visualizar` | 093 |
| `POST /api/presencas` | `equipe.criar` | 093 |
| `PATCH /api/presencas/{id}/saida` | `equipe.criar` ou `equipe.editar` | 093 |

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

Usa a auditoria da Fundação (`public.audit_log`, via `audit()` em `src/db/helpers.js`), que já grava autor, data/hora, ação, entidade e identificador. O resultado vai em `payload.resultado` (`sucesso` ou `recusado_conflito`). O payload não leva texto clínico livre nem contatos de colaboradores (na edição, só os nomes dos campos alterados).

| Ação | Quando |
|---|---|
| `tipo_atendimento.criar` · `editar` · `ativar` · `inativar` | Alterações em tipos |
| `colaborador.criar` · `editar` · `ativar` · `inativar` | Alterações em colaboradores |
| `agendamento.criar` · `reagendar` · `cancelar` · `realizado` · `nao_realizado` · `corrigir_realizacao` | Alterações em agendamentos; criar e reagendar também registram recusas por conflito |
| `colaborador.disponibilidade` | Substituição da disponibilidade |
| `especialidade.criar` · `editar` · `ativar` · `inativar` | Alterações no catálogo de especialidades |
| `registro_clinico.criar` · `criar_finalizado` · `editar` · `finalizar` · `adendo` · `republicar` | Registro clínico |
| `acompanhamento_odontologico.criar` · `editar` · `tratamento_externo.criar` · `editar` · `odontologia.configuracao_ciclo` | Atendimento odontológico e externo |
| `registro_clinico.ler` · `acompanhamento_odontologico.ler` · `tratamento_externo.ler` · `odontologia_pendencias.ler` | **Leitura** de dados clínicos: usuário, data/hora, idosos (`payload.idosos`), registros e rota |
| `escala.criar` · `editar` · `situacao` | Alterações em escalas |
| `escala.cobertura` | Substituição da cobertura mínima (com a versão anterior) |
| `presenca.registrar` · `saida` | Registro de presença e saída |

## Contratos de integração

| Porta | Arquivo | Situação | Contrato |
|---|---|---|---|
| Idosos (G1, US-011) | `src/grupo3/portas/idosos.js` | Adaptador real sobre `public.patients` | `buscarIdoso(idosoId) → { id, ref, nome, ativo } \| null`; `buscarIdososPorRef(refs) → Map<ref, idoso>`. `ativo` é sempre `true`: `TODO(integracao-G1)` |
| Prontuário — visibilidade (G1, US-031) | `src/grupo3/portas/prontuario.js` | Stub `TODO(integracao-G1)` | `podeVerIdoso(usuario, idoso) → boolean`, chamado no histórico do idoso |
| Prontuário — evolução (G1, US-023) | `src/grupo3/portas/prontuario.js` | **Adaptador real**: a evolução já existe no repositório (`public.evolutions`) | `publicarNoProntuario({ idosoId, autorUsuarioId, area, tipo, realizadoEm, resumo, adendo, referenciaId }, db) → { status: "publicado", referencia }`, chamado só se `podePublicar(autor)` (`evolucao.create`); senão `aguardando_permissao`. Cria uma evolução `finalizado` do tipo `reavaliacao` (temporário, `TODO(integracao-G1)`), com título "Consulta médica: …", "Consulta odontológica: …" ou "Adendo · …", na mesma transação do registro |
| Prontuário — linha do tempo (G1, US-030) | `src/grupo3/portas/prontuario.js` | Não existe; `TODO(integracao-G1)` | Quando existir, publicar também nela |
| Notificações (G4, US-117) | `src/grupo3/portas/notificacoes.js` | Adaptador real do canal interno sobre `public.notifications`; `TODO(integracao-G4)` para o serviço do Grupo 4 | `enviarNotificacao({ usuarioId, titulo, corpo, link }, db) → { status: "enviado" \| "entregue", canal, referencia }`. Exceção = falha (o job tenta de novo) |
| Jobs (T-008) | `src/grupo3/jobs.js` | Agendador no processo, ligado por `JOBS_ENABLED=true` | `iniciarJobs({ intervaloSeg, jobs })` e `pararJobs()` (chamado no `SIGTERM`/`SIGINT` de `src/server.js`). Cada rodada tem try/catch com log sem dados sensíveis; se a anterior de um job ainda está rodando, a nova é pulada. `processarLembretes({ agora, limite, enviar })` também pode ser chamado direto |
| Indicadores (G5) | — | Fatia 6 | `GET /api/indicadores/atendimentos \| tarefas \| equipe` |
