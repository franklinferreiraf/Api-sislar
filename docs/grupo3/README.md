# Grupo 3 — Agenda, atendimentos e profissionais

Backend dos épicos E07 (agenda, cuidados e atendimentos), E08 (fisioterapia), E09 (atendimento médico e odontológico) e E10 parcial (US-091 a US-096).

| Fatia | Escopo | Situação |
|---|---|---|
| 1 | `Colaborador` mínimo, US-065, US-066, US-067, US-068, US-069, US-072, US-073 | **Entregue** |
| 2 | US-070, US-071, US-074 (lembretes + job) | **Entregue** |
| 3 | US-091, US-092, US-082, US-083, US-084, US-093 | **Entregue** |
| 4 | US-085 a US-089 | **Entregue** |
| 5 | US-075 a US-080 | **Entregue** |
| 6 | US-094 a US-096 + indicadores para o Grupo 5 + jobs de alerta | **Entregue** |
| 7 | US-081, US-090 (P2) | **Entregue** |

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
| `src/grupo3/alertas.js` | Jobs de tarefas atrasadas e de pendências odontológicas, sem notificação repetida |
| `src/routes/grupo3/` | Rotas, montadas em `/api` por `index.js` (`agendamentos`, `tipos-atendimento`, `colaboradores`, `especialidades`, `escalas`, `presencas`, `clinico`, `fisioterapia`, `tarefas`, `indicadores`, `relatorios`) |
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
    PATIENTS_public ||--o{ PLANO_FISIOTERAPIA : "idoso_ref (vários ativos)"
    PLANO_FISIOTERAPIA |o--o{ AGENDAMENTO : "sessões"
    PLANO_FISIOTERAPIA ||--o{ ATIVIDADE_FISIOTERAPIA : "atividades"
    AGENDAMENTO ||--o{ EXECUCAO_ATIVIDADE : "sessão"
    ATIVIDADE_FISIOTERAPIA ||--o{ EXECUCAO_ATIVIDADE : "execuções"
    PLANO_FISIOTERAPIA ||--o{ EVOLUCAO_FISIOTERAPIA : "linha cronológica"
    EXECUCAO_ATIVIDADE ||--o{ CORRECAO_EXECUCAO_ATIVIDADE : "correções"
    COLABORADOR ||--o{ TAREFA : "responsável"
    TAREFA ||--o{ HISTORICO_TAREFA : "status"
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
    PLANO_FISIOTERAPIA {
        uuid id PK
        uuid idoso_ref
        uuid responsavel_id FK
        text objetivo
        date data_inicio
        date data_fim
        smallint frequencia_semanal
        enum situacao "ativo | suspenso | concluido | cancelado"
    }
    ATIVIDADE_FISIOTERAPIA {
        uuid id PK
        uuid plano_id FK
        text descricao
        smallint frequencia_semanal
        int duracao_min
        text intensidade
        jsonb configuracao "flexível"
        bool ativa
    }
    EXECUCAO_ATIVIDADE {
        uuid id PK
        uuid agendamento_id FK "sessão; único com atividade"
        uuid atividade_id FK
        uuid profissional_id FK
        enum status "realizada | parcial | nao_realizada"
        timestamptz registrado_em
    }
    EVOLUCAO_FISIOTERAPIA {
        uuid id PK
        uuid plano_id FK
        uuid agendamento_id FK "opcional"
        text texto
        timestamptz registrado_em
        uuid autor_ref
        text publicacao_status
        text prontuario_ref
    }
    CORRECAO_EXECUCAO_ATIVIDADE {
        uuid id PK
        uuid execucao_id FK
        jsonb anterior
        jsonb novo
        text motivo
        uuid autor_ref
    }
    TAREFA {
        uuid id PK
        text titulo
        text descricao
        uuid responsavel_id FK
        timestamptz prazo
        enum prioridade "baixa | media | alta | urgente"
        enum status "pendente | em_andamento | concluida | cancelada"
        timestamptz concluida_em
        uuid criado_por_ref
    }
    HISTORICO_TAREFA {
        uuid id PK
        uuid tarefa_id FK
        text evento "criada | status | reaberta"
        enum status_anterior
        enum status_novo
        text observacao
        uuid autor_ref
        timestamptz em
    }
    NOTIFICACAO_CONTROLE {
        text chave PK "tarefa_atrasada[_criador]:<id> | odonto_pendente:<ciclo>:<idoso_ref>"
        text tipo
        text status "enviada | sem_destinatario"
        int destinatarios
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
        uuid plano_fisioterapia_id FK "sessão de fisioterapia"
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

**Fisioterapia (US-075 a US-080).** O **plano** tem objetivo, período, frequência semanal, observações, responsável e situação; um idoso pode ter **mais de um plano ativo**. As **atividades** têm descrição, frequência, duração, intensidade e `configuracao` flexível (jsonb validado), e são inativadas em vez de excluídas. A **sessão** é um agendamento de categoria `fisioterapia` com `planoFisioterapiaId` (FK opcional): o plano precisa ser do mesmo idoso e estar ativo, e sessão fora do período do plano é aceita com o aviso `fora_do_periodo_do_plano`. A **execução de atividade** fica sempre vinculada à sessão (`agendamento_id`), uma por atividade e sessão. Só é aceita em sessão `realizado`, ou `agendado` já dentro da tolerância do tipo; sessão `cancelado` ou `nao_realizado` é 422. É imutável: a correção é `POST /api/fisioterapia/execucoes/{id}/corrigir` (`fisioterapia.administrar`, motivo obrigatório), que grava anterior → novo em `correcao_execucao_atividade` (imutável) e usa a flag local `grupo3.correcao_execucao`, como `corrigir-realizacao`. A **evolução do plano** é uma linha cronológica imutável e segue a regra de publicação do registro clínico (publica só se o autor tem `evolucao.create`; senão `aguardando_permissao`, com `POST /api/fisioterapia/evolucoes/republicar-pendentes`). A **rotina semanal** mostra as sessões da semana e a carga por dia, contando só `agendado` e `realizado`; `programar-semana` cria as sessões de um plano de uma vez, com a mesma validação do agendamento e tudo ou nada. Os **indicadores** trazem planos ativos e vigentes, idosos em fisioterapia e sessões previstas, realizadas, não realizadas e canceladas.

**Tarefas (US-094 a US-096).** Tarefa com título, descrição, responsável (colaborador ativo), prazo, prioridade (`baixa`, `media`, `alta`, `urgente`) e status (`pendente`, `em_andamento`, `concluida`, `cancelada`). O **status** pode ser alterado pelo **responsável** (o usuário vinculado ao colaborador, via `usuario_ref`) ou por quem tem `tarefas.administrar`; cada mudança grava autor, data e observação no **histórico imutável** (`historico_tarefa`, com o evento `criada`, `status` ou `reaberta`) e `concluida_em` ao concluir. Concluída e cancelada são finais; só `POST /api/tarefas/{id}/reabrir` (`tarefas.administrar`, motivo obrigatório) as devolve a `pendente`, gravando o evento `reaberta` (o banco só aceita com a flag local `grupo3.reabertura_tarefa`). **Atrasada é derivado** (prazo vencido e tarefa pendente ou em andamento), não é status gravado. Os dados da tarefa são editados por quem a criou ou por `tarefas.administrar`.

**Jobs de alerta (T-008).** Rodam no agendador (`JOBS_ENABLED=true`) e **não repetem notificação**: o que já foi avisado fica em `notificacao_controle`, com chave única.
- **Tarefas atrasadas:** uma notificação por tarefa atrasada, para o usuário do responsável (`kind = "tarefa"`, chave `tarefa_atrasada:<id>`, gravada só quando o aviso sai). Se o responsável não tem usuário ativo, avisa uma vez **quem criou a tarefa** (chave `tarefa_atrasada_criador:<id>`). Ao vincular um usuário ao colaborador, a rodada seguinte avisa o responsável das tarefas dele que continuam abertas e atrasadas, como nos lembretes.
- **Pendências odontológicas:** um aviso por idoso por ciclo (chave `odonto_pendente:<ciclo>:<idoso_ref>`). A cada rodada com idosos ainda não avisados, sai **um resumo sem nomes** ("5 idosos sem avaliação odontológica no ciclo 2026-2", com link para `/odontologia/pendencias?ciclo=2026-2`) para cada usuário com `atendimento-clinico.administrar` (`kind = "odontologia"`). No modo `dias_corridos`, o "ciclo" do controle é o mês corrente.

**Relatórios (US-081, US-090).** O Grupo 5 ainda não tem serviço de relatórios/exportação (T-006) no repositório; por isso os relatórios são endpoints JSON com filtros e paginação, e a exportação para PDF/planilha fica com o G5. Os dois aceitam no máximo **12 meses** por consulta (422 acima disso), com padrão do primeiro dia do mês corrente até hoje, e têm a **leitura auditada**.
- `GET /api/fisioterapia/relatorios/evolucao` (`fisioterapia.visualizar`): por plano cujo período toca o do relatório, consolida o plano, as sessões (realizadas, não realizadas, canceladas, agendadas), as execuções por atividade e as evoluções no período. Filtros: idoso e plano.
- `GET /api/relatorios/consultas-tratamentos` (`atendimento-clinico.visualizar` ou `modulo.relatorios`): consultas e tratamentos externos com filtros por período, área, profissional, idoso e status. **Por padrão só metadados** (data, idoso, profissional, tipo, status); o conteúdo clínico (registro da consulta, observações do tratamento) só vem com `incluirConteudo=true`, que exige `atendimento-clinico.visualizar`.

**Auditoria de leitura.** Ler registro clínico, acompanhamento odontológico, tratamento externo, pendências, plano, execuções e evoluções de fisioterapia e os relatórios da Fatia 7 grava `<entidade>.ler` no `audit_log`, com quem acessou (`user_id`), quando (`at`), quais idosos (`payload.idosos`), quais registros e a rota.

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
| `GET /api/fisioterapia/planos` · `GET /api/fisioterapia/planos/{id}` · `GET /api/idosos/{idosoId}/planos-fisioterapia` | `fisioterapia.visualizar` (leitura auditada) | 075 |
| `POST /api/fisioterapia/planos` | `fisioterapia.criar` | 075 |
| `PUT /api/fisioterapia/planos/{id}` | `fisioterapia.editar` | 075 |
| `GET /api/fisioterapia/planos/{id}/atividades` | `fisioterapia.visualizar` | 076 |
| `POST /api/fisioterapia/planos/{id}/atividades` | `fisioterapia.criar` | 076 |
| `PUT /api/fisioterapia/atividades/{id}` | `fisioterapia.editar` | 076 |
| `POST /api/fisioterapia/atividades/{id}/execucoes` | `fisioterapia.criar` | 077 |
| `GET /api/fisioterapia/planos/{id}/execucoes` · `GET /api/fisioterapia/execucoes/{id}` | `fisioterapia.visualizar` (leitura auditada) | 077 |
| `POST /api/fisioterapia/execucoes/{id}/corrigir` | `fisioterapia.administrar` | 077 |
| `GET /api/fisioterapia/planos/{id}/evolucoes` | `fisioterapia.visualizar` (leitura auditada) | 078 |
| `POST /api/fisioterapia/planos/{id}/evolucoes` | `fisioterapia.criar` | 078 |
| `POST /api/fisioterapia/evolucoes/republicar-pendentes` | `fisioterapia.administrar` | 078 |
| `POST /api/fisioterapia/planos/{id}/programar-semana` | `fisioterapia.criar` e `agenda.criar` | 079 |
| `GET /api/fisioterapia/rotina-semanal?semana&profissionalId` | `fisioterapia.visualizar` | 079 |
| `GET /api/fisioterapia/indicadores?inicio&fim` | `fisioterapia.visualizar` | 080 |
| `GET /api/tarefas?responsavelId&status&prioridade&atrasadas&prazoAte&q` · `GET /api/tarefas/{id}` · `GET /api/me/tarefas` | `tarefas.visualizar` | 094, 096 |
| `POST /api/tarefas` | `tarefas.criar` | 094 |
| `PUT /api/tarefas/{id}` | `tarefas.criar` (quem criou) ou `tarefas.administrar` | 094 |
| `PATCH /api/tarefas/{id}/status` | `tarefas.editar` (responsável) ou `tarefas.administrar` | 095 |
| `POST /api/tarefas/{id}/reabrir` | `tarefas.administrar` | 095 |
| `GET /api/indicadores/atendimentos` · `/tarefas` · `/equipe` | `modulo.dashboard` (proposta; pergunta ao G5) | 080, 096, 100, 119, 123, 128 |
| `GET /api/fisioterapia/relatorios/evolucao?inicio&fim&idosoId&planoId` | `fisioterapia.visualizar` (leitura auditada) | 081 |
| `GET /api/relatorios/consultas-tratamentos?inicio&fim&area&profissionalId&idosoId&status&incluirConteudo` | `atendimento-clinico.visualizar` ou `modulo.relatorios`; conteúdo só com `atendimento-clinico.visualizar` (leitura auditada) | 090 |
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
| `plano_fisioterapia.criar` · `editar` · `atividade_fisioterapia.criar` · `editar` · `execucao_atividade.registrar` · `corrigir` · `evolucao_fisioterapia.registrar` · `republicar` | Fisioterapia |
| `tarefa.criar` · `editar` · `status` · `reabrir` | Tarefas (o histórico de status fica também em `historico_tarefa`) |
| `registro_clinico.ler` · `acompanhamento_odontologico.ler` · `tratamento_externo.ler` · `odontologia_pendencias.ler` · `plano_fisioterapia.ler` · `execucao_atividade.ler` · `evolucao_fisioterapia.ler` · `relatorio_fisioterapia.ler` · `relatorio_consultas_tratamentos.ler` | **Leitura** de dados clínicos: usuário, data/hora, idosos (`payload.idosos`), registros e rota |
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
| Indicadores (G5) | `src/routes/grupo3/indicadores.js` | Entregue | `GET /api/indicadores/atendimentos \| tarefas \| equipe` (só números) e `GET /api/fisioterapia/indicadores`. Definições na seção "Indicadores para o Grupo 5" |

## Indicadores para o Grupo 5 (US-128)

Todos os indicadores são **só números**: não trazem nome nem identificador de idoso. **Taxas** são percentuais com uma casa decimal e valem **`null` quando o denominador é zero** (nunca 0). Datas e períodos usam o **fuso da instituição** (`grupo3.configuracao.fuso_horario`, padrão `America/Sao_Paulo`); o período `[inicio, fim]` vai de `inicio` 00:00 até o fim do dia `fim`, no horário local. A permissão de leitura proposta é `modulo.dashboard` (a mesma do `/api/dashboard`), ainda como pergunta ao G5.

### `GET /api/indicadores/atendimentos?inicio&fim`

Período padrão: do primeiro dia do mês corrente até hoje. Agendamentos com **início** dentro do período, no total e por categoria do tipo.

| Indicador | Fórmula |
|---|---|
| `total` | agendamentos com início no período |
| `agendados` · `realizados` · `naoRealizados` · `cancelados` | contagem por status atual |
| `previstos` | `total − cancelados` |
| `pendentesDeRegistro` | status `agendado` e fim já passou (agora) |
| `taxaRealizacao` | `realizados ÷ (realizados + naoRealizados) × 100` |
| `taxaCancelamento` | `cancelados ÷ total × 100` |
| `porCategoria[]` | os mesmos números por categoria (`consulta_medica`, `fisioterapia`, `cuidado_pessoal`...) |

### `GET /api/indicadores/tarefas?inicio&fim`

Período padrão: do primeiro dia do mês corrente até hoje.

| Indicador | Fórmula | Referência de tempo |
|---|---|---|
| `agora.abertas` | tarefas `pendente` ou `em_andamento` | agora (ignora o período) |
| `agora.atrasadas` | abertas com prazo < agora | agora |
| `agora.taxaAtraso` | `atrasadas ÷ abertas × 100` | agora |
| `agora.porPrioridade[]` | abertas e atrasadas por prioridade | agora |
| `noPeriodo.criadas` | criadas no período | período |
| `noPeriodo.concluidas` | `concluida_em` no período | período |
| `noPeriodo.concluidasNoPrazo` | concluídas no período com `concluida_em ≤ prazo` | período |
| `noPeriodo.canceladas` | mudanças para `cancelada` no período (histórico) | período |
| `noPeriodo.taxaConclusaoNoPrazo` | `concluidasNoPrazo ÷ concluidas × 100` | período |

### `GET /api/indicadores/equipe?data`

Data padrão: hoje.

| Indicador | Fórmula |
|---|---|
| `colaboradoresAtivos` · `porVinculo[].ativos` | colaboradores com status `ativo` (agora), total e por vínculo |
| `presentesNoDia` · `ausentesNoDia` | presenças `presente` / `ausente` com `data` = dia |
| `presentesAgora` | presenças `presente` sem saída registrada (agora, qualquer data) |
| `escalasNoDia` | escalas não canceladas com início no dia |
| `escalasComPresenca` | dessas, as que têm presença `presente` ligada |
| `taxaPresencaEscala` | `escalasComPresenca ÷ escalasNoDia × 100` |

A presença é registro operacional e **não substitui o controle de ponto**.

### `GET /api/fisioterapia/indicadores?inicio&fim` (US-080)

Período padrão: do primeiro dia do mês corrente até hoje. `planos.ativos` = situação `ativo` e hoje dentro do período do plano; `planos.idososEmFisioterapia` = idosos distintos com plano ativo; sessões de categoria `fisioterapia` com início no período: `previstas` = não canceladas, `taxaRealizacao` = `realizadas ÷ (realizadas + naoRealizadas) × 100`.
