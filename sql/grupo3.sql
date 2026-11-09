BEGIN;

-- Grupo 3 — Agenda, atendimentos e profissionais (E07–E10).
-- Usuários e idosos entram só como UUID (users.ref, patients.ref), validados pela API.
CREATE SCHEMA IF NOT EXISTS grupo3;
-- btree_gist: restrição de exclusão (sem sobreposição) com uuid na escala.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
SET search_path = grupo3, pg_catalog;

CREATE TYPE vinculo_colaborador AS ENUM ('funcionario','voluntario','externo');
CREATE TYPE status_colaborador AS ENUM ('ativo','inativo');
CREATE TYPE categoria_atendimento AS ENUM (
  'consulta_medica','consulta_odontologica','fisioterapia','cuidado_pessoal','farmacia','avaliacao','outro'
);
CREATE TYPE status_agendamento AS ENUM ('agendado','realizado','nao_realizado','cancelado');
CREATE TYPE situacao_escala AS ENUM ('prevista','confirmada','cancelada');
CREATE TYPE situacao_presenca AS ENUM ('presente','ausente');
CREATE TYPE area_clinica AS ENUM ('medica','odontologica');
CREATE TYPE status_registro_clinico AS ENUM ('rascunho','finalizado');
CREATE TYPE situacao_acompanhamento AS ENUM ('em_tratamento','em_acompanhamento','concluido','suspenso');
CREATE TYPE area_tratamento_externo AS ENUM ('medica','odontologica','outra');
CREATE TYPE status_lembrete AS ENUM ('pendente','enviado','entregue','falha','sem_destinatario','cancelado');

-- Regras configuráveis do grupo (chave/valor). Ver docs/grupo3/decisoes-pendentes.md.
CREATE TABLE configuracao (
  chave text PRIMARY KEY CHECK (chave ~ '^[a-z0-9_.]+$'),
  valor jsonb NOT NULL,
  descricao text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO configuracao (chave, valor, descricao) VALUES
  ('fuso_horario', '"America/Sao_Paulo"', 'Fuso da instituição para dia/semana/mês.'),
  ('lembretes.antecedencias_min', '[1440]', 'Antecedências padrão dos lembretes, em minutos (tipo sem configuração própria).'),
  ('lembretes.max_tentativas', '3', 'Tentativas de envio antes de marcar o lembrete como falha.'),
  ('odontologia.ciclo', '{"modo": "semestre_civil", "dias": 180}',
   'Ciclo do acompanhamento odontológico (US-089): semestre_civil (jan–jun / jul–dez) ou dias_corridos.');

CREATE FUNCTION fuso_horario() RETURNS text LANGUAGE sql STABLE SET search_path = grupo3, pg_catalog AS $$
  SELECT coalesce((SELECT valor #>> '{}' FROM configuracao WHERE chave = 'fuso_horario'), 'America/Sao_Paulo')
$$;

-- Intervalo [inicio, fim) de um dia, semana (segunda a domingo) ou mês no fuso da instituição.
CREATE FUNCTION periodo(p_data date, p_visao text, OUT inicio timestamptz, OUT fim timestamptz)
LANGUAGE plpgsql STABLE SET search_path = grupo3, pg_catalog AS $$
DECLARE base timestamp; passo interval;
BEGIN
  IF p_visao NOT IN ('dia','semana','mes') THEN
    RAISE EXCEPTION 'Visão inválida. Use dia, semana ou mes.';
  END IF;
  base := date_trunc(CASE p_visao WHEN 'dia' THEN 'day' WHEN 'semana' THEN 'week' ELSE 'month' END, p_data::timestamp);
  passo := CASE p_visao WHEN 'dia' THEN interval '1 day' WHEN 'semana' THEN interval '1 week' ELSE interval '1 month' END;
  inicio := base AT TIME ZONE fuso_horario();
  fim := (base + passo) AT TIME ZONE fuso_horario();
END $$;

CREATE FUNCTION impedir_exclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro não pode ser excluído; use inativação ou cancelamento.';
END $$;

CREATE FUNCTION impedir_alteracao_historico() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Histórico não pode ser alterado nem excluído.';
END $$;

CREATE FUNCTION marcar_atualizacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

-- Catálogo de especialidades/áreas (chave da cobertura da escala). Sem exclusão física: inativar.
CREATE TABLE especialidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 80),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX indice_especialidade_nome ON especialidade (lower(btrim(nome)));
CREATE TRIGGER marcar_atualizacao_especialidade BEFORE UPDATE ON especialidade
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_especialidade BEFORE DELETE ON especialidade
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Cadastro único da equipe (funcionários, voluntários e externos) — US-082, US-091, US-092.
-- Sem CPF nem documento: não há uso definido. Contatos só aparecem com equipe.visualizar.
CREATE TABLE colaborador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 3 AND 160),
  vinculo vinculo_colaborador NOT NULL,
  status status_colaborador NOT NULL DEFAULT 'ativo',
  cargo text CHECK (cargo IS NULL OR char_length(cargo) BETWEEN 2 AND 120),
  setor text CHECK (setor IS NULL OR char_length(setor) BETWEEN 2 AND 120),
  especialidade_id uuid REFERENCES especialidade(id),
  registro_profissional text CHECK (registro_profissional IS NULL OR char_length(registro_profissional) <= 60),
  email text CHECK (email IS NULL OR (char_length(email) <= 160 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  telefone text CHECK (telefone IS NULL OR telefone ~ '^[0-9 ()+-]{8,20}$'),
  usuario_ref uuid UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indice_colaborador_nome ON colaborador (lower(nome));
CREATE INDEX indice_colaborador_especialidade ON colaborador (especialidade_id) WHERE especialidade_id IS NOT NULL;

-- Disponibilidade semanal declarada (US-082, US-092), no relógio da instituição.
-- dia_semana ISO: 1 = segunda ... 7 = domingo. hora_fim aceita 24:00 (fim do dia); disponibilidade que
-- atravessa a meia-noite é declarada em dois dias (ex.: seg 19:00–24:00 e ter 00:00–07:00).
CREATE TABLE disponibilidade_colaborador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES colaborador(id),
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  hora_inicio time NOT NULL,
  hora_fim time NOT NULL,
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 300),
  CHECK (hora_fim > hora_inicio),
  EXCLUDE USING gist (
    colaborador_id public.gist_uuid_ops WITH =,
    dia_semana WITH =,
    tsrange('2000-01-01'::date + hora_inicio, '2000-01-01'::date + hora_fim) WITH &&
  )
);
CREATE TRIGGER marcar_atualizacao_colaborador BEFORE UPDATE ON colaborador
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_colaborador BEFORE DELETE ON colaborador
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Tipos de atendimento e serviços (US-065).
CREATE TABLE tipo_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 2 AND 120),
  categoria categoria_atendimento NOT NULL,
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 1000),
  duracao_padrao_min integer NOT NULL CHECK (duracao_padrao_min BETWEEN 5 AND 720),
  exige_motivo_cancelamento boolean NOT NULL DEFAULT true,
  exige_motivo_reagendamento boolean NOT NULL DEFAULT true,
  permite_sobreposicao boolean NOT NULL DEFAULT false,
  -- Quantos minutos antes do início a realização já pode ser registrada.
  tolerancia_realizacao_min integer NOT NULL DEFAULT 60 CHECK (tolerancia_realizacao_min BETWEEN 0 AND 1440),
  -- Antecedências dos lembretes em minutos. NULL usa lembretes.antecedencias_min; vazio desliga os lembretes.
  antecedencias_lembrete_min integer[] CHECK (
    antecedencias_lembrete_min IS NULL OR (
      cardinality(antecedencias_lembrete_min) <= 5
      AND 5 <= ALL (antecedencias_lembrete_min) AND 10080 >= ALL (antecedencias_lembrete_min)
    )
  ),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX indice_tipo_atendimento_nome ON tipo_atendimento (lower(nome));
CREATE TRIGGER marcar_atualizacao_tipo_atendimento BEFORE UPDATE ON tipo_atendimento
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_tipo_atendimento BEFORE DELETE ON tipo_atendimento
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Agenda única (US-066 a US-073). "fim" é preenchido por gatilho: timestamptz + interval é STABLE
-- e não pode ser coluna gerada.
CREATE TABLE agendamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idoso_ref uuid NOT NULL,
  tipo_id uuid NOT NULL REFERENCES tipo_atendimento(id),
  profissional_id uuid NOT NULL REFERENCES colaborador(id),
  inicio timestamptz NOT NULL,
  duracao_min integer NOT NULL CHECK (duracao_min BETWEEN 5 AND 720),
  fim timestamptz NOT NULL,
  local text CHECK (local IS NULL OR char_length(local) <= 120),
  observacoes text CHECK (observacoes IS NULL OR char_length(observacoes) <= 2000),
  status status_agendamento NOT NULL DEFAULT 'agendado',
  motivo_status text CHECK (motivo_status IS NULL OR char_length(motivo_status) <= 1000),
  responsavel_realizacao_id uuid REFERENCES colaborador(id),
  observacao_realizacao text CHECK (observacao_realizacao IS NULL OR char_length(observacao_realizacao) <= 2000),
  concluido_em timestamptz,
  -- Usuário que registrou a realização ou o cancelamento (o responsável pode ser outra pessoa).
  registrado_por_ref uuid,
  criado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  CHECK ((status = 'agendado') = (concluido_em IS NULL)),
  CHECK ((status = 'agendado') = (registrado_por_ref IS NULL)),
  CHECK (status NOT IN ('realizado','nao_realizado') OR responsavel_realizacao_id IS NOT NULL)
);
CREATE INDEX indice_agendamento_profissional_ativo ON agendamento (profissional_id, inicio) WHERE status = 'agendado';
CREATE INDEX indice_agendamento_idoso ON agendamento (idoso_ref, inicio DESC);
CREATE INDEX indice_agendamento_inicio ON agendamento (inicio);

-- Encerrado é imutável. Única exceção: a correção de realização (POST .../corrigir-realizacao), que liga
-- grupo3.correcao_realizacao na transação e só pode trocar status (entre realizado e não realizado),
-- responsável e observação da realização.
CREATE FUNCTION preparar_agendamento() RETURNS trigger LANGUAGE plpgsql SET search_path = grupo3, pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'agendado' THEN
    IF coalesce(current_setting('grupo3.correcao_realizacao', true), '') <> 'on'
       OR OLD.status NOT IN ('realizado','nao_realizado')
       OR NEW.status NOT IN ('realizado','nao_realizado')
       OR (NEW.idoso_ref, NEW.tipo_id, NEW.profissional_id, NEW.inicio, NEW.duracao_min, NEW.local, NEW.observacoes,
           NEW.motivo_status, NEW.concluido_em, NEW.registrado_por_ref, NEW.criado_por_ref, NEW.criado_em)
          IS DISTINCT FROM
          (OLD.idoso_ref, OLD.tipo_id, OLD.profissional_id, OLD.inicio, OLD.duracao_min, OLD.local, OLD.observacoes,
           OLD.motivo_status, OLD.concluido_em, OLD.registrado_por_ref, OLD.criado_por_ref, OLD.criado_em) THEN
      RAISE EXCEPTION 'Agendamento encerrado não pode ser alterado.';
    END IF;
  END IF;
  NEW.fim := NEW.inicio + make_interval(mins => NEW.duracao_min);
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
CREATE TRIGGER preparar_agendamento_antes_de_gravar BEFORE INSERT OR UPDATE ON agendamento
  FOR EACH ROW EXECUTE FUNCTION preparar_agendamento();
CREATE TRIGGER impedir_exclusao_agendamento BEFORE DELETE ON agendamento
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Trilha de alterações do agendamento (US-068). Imutável.
CREATE TABLE historico_agendamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid NOT NULL REFERENCES agendamento(id),
  acao text NOT NULL CHECK (acao IN ('criado','reagendado','cancelado','realizado','nao_realizado','corrigido')),
  anterior jsonb,
  novo jsonb,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 1000),
  autor_ref uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indice_historico_agendamento ON historico_agendamento (agendamento_id, em);
CREATE TRIGGER preservar_historico_agendamento BEFORE UPDATE OR DELETE ON historico_agendamento
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_historico();

-- Lembretes de atendimento (US-074). O Grupo 3 agenda o envio e registra o status; a entrega é da
-- camada de notificações (Grupo 4), acessada pela porta src/grupo3/portas/notificacoes.js.
CREATE TABLE lembrete_agendamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid NOT NULL REFERENCES agendamento(id),
  colaborador_id uuid NOT NULL REFERENCES colaborador(id),
  usuario_ref uuid,
  antecedencia_min integer NOT NULL CHECK (antecedencia_min BETWEEN 5 AND 10080),
  enviar_em timestamptz NOT NULL,
  canal text NOT NULL DEFAULT 'interno' CHECK (canal ~ '^[a-z_]+$'),
  status status_lembrete NOT NULL DEFAULT 'pendente',
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_erro text CHECK (ultimo_erro IS NULL OR char_length(ultimo_erro) <= 500),
  notificacao_id text,
  enviado_em timestamptz,
  entregue_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('enviado','entregue') OR enviado_em IS NOT NULL),
  CHECK (status <> 'entregue' OR entregue_em IS NOT NULL)
);
CREATE UNIQUE INDEX indice_lembrete_ativo ON lembrete_agendamento (agendamento_id, colaborador_id, antecedencia_min)
  WHERE status IN ('pendente','sem_destinatario');
CREATE INDEX indice_lembrete_fila ON lembrete_agendamento (enviar_em) WHERE status = 'pendente';
CREATE INDEX indice_lembrete_agendamento ON lembrete_agendamento (agendamento_id);
CREATE TRIGGER marcar_atualizacao_lembrete BEFORE UPDATE ON lembrete_agendamento
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_lembrete BEFORE DELETE ON lembrete_agendamento
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Escala de atendimento: o PLANEJADO (US-083). Instantes em timestamptz: um plantão 19h–07h é um
-- registro só. A API recebe data + horários no fuso da instituição.
CREATE TABLE escala (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES colaborador(id),
  especialidade_id uuid REFERENCES especialidade(id),
  local text NOT NULL CHECK (char_length(btrim(local)) BETWEEN 2 AND 120),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  situacao situacao_escala NOT NULL DEFAULT 'prevista',
  observacao text CHECK (observacao IS NULL OR char_length(observacao) <= 500),
  motivo_cancelamento text CHECK (motivo_cancelamento IS NULL OR char_length(motivo_cancelamento) <= 500),
  criado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  CHECK (fim - inicio <= interval '24 hours'),
  -- Mesmo colaborador não fica em dois turnos sobrepostos (cancelados não contam).
  EXCLUDE USING gist (
    colaborador_id public.gist_uuid_ops WITH =,
    tstzrange(inicio, fim) WITH &&
  ) WHERE (situacao <> 'cancelada')
);
CREATE INDEX indice_escala_periodo ON escala (inicio, fim);
CREATE INDEX indice_escala_especialidade ON escala (especialidade_id, inicio);
CREATE TRIGGER marcar_atualizacao_escala BEFORE UPDATE ON escala
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_escala BEFORE DELETE ON escala
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Necessidade mínima de cobertura da escala (US-084), configurável pela gestão. hora_fim aceita 24:00;
-- necessidade noturna é declarada em dois dias (ex.: qua 19:00–24:00 e qui 00:00–07:00).
CREATE TABLE cobertura_necessaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  especialidade_id uuid NOT NULL REFERENCES especialidade(id),
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  hora_inicio time NOT NULL,
  hora_fim time NOT NULL,
  quantidade_minima smallint NOT NULL CHECK (quantidade_minima BETWEEN 1 AND 50),
  CHECK (hora_fim > hora_inicio),
  EXCLUDE USING gist (
    especialidade_id public.gist_uuid_ops WITH =,
    dia_semana WITH =,
    tsrange('2000-01-01'::date + hora_inicio, '2000-01-01'::date + hora_fim) WITH &&
  )
);

-- Presença: o que ACONTECEU (US-093). Registro operacional, não é controle de ponto. Separada da escala;
-- pode apontar para o turno previsto. "data" é o dia (no fuso da instituição) da entrada ou da ausência;
-- entrada/saída em timestamptz para plantões que atravessam a meia-noite.
CREATE TABLE presenca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id uuid NOT NULL REFERENCES colaborador(id),
  escala_id uuid REFERENCES escala(id),
  data date NOT NULL,
  situacao situacao_presenca NOT NULL DEFAULT 'presente',
  entrada_em timestamptz,
  saida_em timestamptz,
  atividade text CHECK (atividade IS NULL OR char_length(atividade) <= 300),
  justificativa text CHECK (justificativa IS NULL OR char_length(justificativa) <= 500),
  registrado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (situacao <> 'presente' OR entrada_em IS NOT NULL),
  CHECK (situacao <> 'ausente' OR (entrada_em IS NULL AND saida_em IS NULL)),
  CHECK (saida_em IS NULL OR (saida_em > entrada_em AND saida_em - entrada_em <= interval '24 hours'))
);
CREATE INDEX indice_presenca_data ON presenca (data, colaborador_id);
CREATE UNIQUE INDEX indice_presenca_escala ON presenca (escala_id) WHERE escala_id IS NOT NULL;
CREATE TRIGGER marcar_atualizacao_presenca BEFORE UPDATE ON presenca
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_presenca BEFORE DELETE ON presenca
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Acompanhamento odontológico (US-087): plano periódico e situação do tratamento. Um ativo por idoso.
CREATE TABLE acompanhamento_odontologico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idoso_ref uuid NOT NULL,
  responsavel_id uuid REFERENCES colaborador(id),
  plano text NOT NULL CHECK (char_length(btrim(plano)) BETWEEN 5 AND 4000),
  periodicidade_dias integer NOT NULL CHECK (periodicidade_dias BETWEEN 7 AND 730),
  proxima_avaliacao date,
  situacao situacao_acompanhamento NOT NULL DEFAULT 'em_acompanhamento',
  observacoes text CHECK (observacoes IS NULL OR char_length(observacoes) <= 2000),
  criado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX indice_acompanhamento_ativo ON acompanhamento_odontologico (idoso_ref)
  WHERE situacao IN ('em_tratamento','em_acompanhamento');
CREATE TRIGGER marcar_atualizacao_acompanhamento BEFORE UPDATE ON acompanhamento_odontologico
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_acompanhamento BEFORE DELETE ON acompanhamento_odontologico
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Registro clínico de consulta (US-086, US-087). rascunho -> finalizado; finalizado não é editado:
-- correção é um adendo (registro novo com adendo_de). Conteúdo além dos campos mínimos em jsonb.
CREATE TABLE registro_clinico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid REFERENCES agendamento(id),
  adendo_de uuid REFERENCES registro_clinico(id),
  acompanhamento_id uuid REFERENCES acompanhamento_odontologico(id),
  idoso_ref uuid NOT NULL,
  area area_clinica NOT NULL,
  profissional_id uuid NOT NULL REFERENCES colaborador(id),
  tipo text NOT NULL CHECK (char_length(btrim(tipo)) BETWEEN 2 AND 80),
  realizado_em timestamptz NOT NULL,
  resumo text NOT NULL CHECK (char_length(btrim(resumo)) BETWEEN 5 AND 8000),
  conteudo jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(conteudo) = 'object' AND octet_length(conteudo::text) <= 20000),
  status status_registro_clinico NOT NULL DEFAULT 'rascunho',
  autor_ref uuid NOT NULL,
  finalizado_em timestamptz,
  finalizado_por_ref uuid,
  -- aguardando_permissao: quem finalizou não tem evolucao.create; publicado depois por republicar-pendentes.
  publicacao_status text CHECK (publicacao_status IS NULL OR publicacao_status IN ('publicado','aguardando_permissao','pendente_integracao','falha')),
  prontuario_ref text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'finalizado') = (finalizado_em IS NOT NULL AND finalizado_por_ref IS NOT NULL)),
  -- Adendo nasce finalizado e aponta para um registro (que não é outro adendo).
  CHECK (adendo_de IS NULL OR status = 'finalizado'),
  CHECK (adendo_de IS NULL OR adendo_de <> id)
);
-- Um registro principal por consulta.
CREATE UNIQUE INDEX indice_registro_por_agendamento ON registro_clinico (agendamento_id)
  WHERE agendamento_id IS NOT NULL AND adendo_de IS NULL;
CREATE INDEX indice_registro_idoso ON registro_clinico (idoso_ref, area, realizado_em DESC);
CREATE INDEX indice_registro_adendo ON registro_clinico (adendo_de) WHERE adendo_de IS NOT NULL;

-- Finalizado é imutável; só a situação da publicação no prontuário pode ser atualizada depois.
CREATE FUNCTION proteger_registro_clinico() RETURNS trigger LANGUAGE plpgsql SET search_path = grupo3, pg_catalog AS $$
BEGIN
  IF OLD.status = 'finalizado' AND (
       (NEW.agendamento_id, NEW.adendo_de, NEW.acompanhamento_id, NEW.idoso_ref, NEW.area, NEW.profissional_id, NEW.tipo,
        NEW.realizado_em, NEW.resumo, NEW.conteudo, NEW.status, NEW.autor_ref, NEW.finalizado_em, NEW.finalizado_por_ref,
        NEW.criado_em)
       IS DISTINCT FROM
       (OLD.agendamento_id, OLD.adendo_de, OLD.acompanhamento_id, OLD.idoso_ref, OLD.area, OLD.profissional_id, OLD.tipo,
        OLD.realizado_em, OLD.resumo, OLD.conteudo, OLD.status, OLD.autor_ref, OLD.finalizado_em, OLD.finalizado_por_ref,
        OLD.criado_em)) THEN
    RAISE EXCEPTION 'Registro clínico finalizado não pode ser alterado; registre um adendo.';
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
CREATE TRIGGER proteger_registro_clinico_antes_de_atualizar BEFORE UPDATE ON registro_clinico
  FOR EACH ROW EXECUTE FUNCTION proteger_registro_clinico();
CREATE TRIGGER impedir_exclusao_registro_clinico BEFORE DELETE ON registro_clinico
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

-- Tratamento realizado fora da instituição (US-088). Ligado ao idoso; agendamento opcional.
CREATE TABLE tratamento_externo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idoso_ref uuid NOT NULL,
  agendamento_id uuid REFERENCES agendamento(id),
  area area_tratamento_externo NOT NULL,
  tipo text NOT NULL CHECK (char_length(btrim(tipo)) BETWEEN 2 AND 120),
  local_externo text NOT NULL CHECK (char_length(btrim(local_externo)) BETWEEN 2 AND 160),
  data date NOT NULL,
  profissional_nome text CHECK (profissional_nome IS NULL OR char_length(profissional_nome) <= 160),
  instituicao text CHECK (instituicao IS NULL OR char_length(instituicao) <= 160),
  observacoes text CHECK (observacoes IS NULL OR char_length(observacoes) <= 4000),
  criado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indice_tratamento_externo_idoso ON tratamento_externo (idoso_ref, area, data DESC);
CREATE TRIGGER marcar_atualizacao_tratamento_externo BEFORE UPDATE ON tratamento_externo
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizacao();
CREATE TRIGGER impedir_exclusao_tratamento_externo BEFORE DELETE ON tratamento_externo
  FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();

COMMIT;
