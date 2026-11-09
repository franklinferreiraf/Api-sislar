BEGIN;

-- Grupo 3 — Agenda, atendimentos e profissionais (E07–E10).
-- Usuários e idosos entram só como UUID (users.ref, patients.ref), validados pela API.
CREATE SCHEMA IF NOT EXISTS grupo3;
SET search_path = grupo3, pg_catalog;

CREATE TYPE vinculo_colaborador AS ENUM ('funcionario','voluntario','externo');
CREATE TYPE status_colaborador AS ENUM ('ativo','inativo');
CREATE TYPE categoria_atendimento AS ENUM (
  'consulta_medica','consulta_odontologica','fisioterapia','cuidado_pessoal','farmacia','avaliacao','outro'
);
CREATE TYPE status_agendamento AS ENUM ('agendado','realizado','nao_realizado','cancelado');

-- Regras configuráveis do grupo (chave/valor). Ver docs/grupo3/decisoes-pendentes.md.
CREATE TABLE configuracao (
  chave text PRIMARY KEY CHECK (chave ~ '^[a-z0-9_.]+$'),
  valor jsonb NOT NULL,
  descricao text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO configuracao (chave, valor, descricao) VALUES
  ('fuso_horario', '"America/Sao_Paulo"', 'Fuso da instituição para dia/semana/mês.');

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

-- Cadastro único da equipe (funcionários, voluntários e externos). Completado na Fatia 3.
CREATE TABLE colaborador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 3 AND 160),
  vinculo vinculo_colaborador NOT NULL,
  status status_colaborador NOT NULL DEFAULT 'ativo',
  usuario_ref uuid UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indice_colaborador_nome ON colaborador (lower(nome));
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
  criado_por_ref uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  CHECK ((status = 'agendado') = (concluido_em IS NULL)),
  CHECK (status NOT IN ('realizado','nao_realizado') OR responsavel_realizacao_id IS NOT NULL)
);
CREATE INDEX indice_agendamento_profissional_ativo ON agendamento (profissional_id, inicio) WHERE status = 'agendado';
CREATE INDEX indice_agendamento_idoso ON agendamento (idoso_ref, inicio DESC);
CREATE INDEX indice_agendamento_inicio ON agendamento (inicio);

CREATE FUNCTION preparar_agendamento() RETURNS trigger LANGUAGE plpgsql SET search_path = grupo3, pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'agendado' THEN
    RAISE EXCEPTION 'Agendamento encerrado não pode ser alterado.';
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
  acao text NOT NULL CHECK (acao IN ('criado','reagendado','cancelado','realizado','nao_realizado')),
  anterior jsonb,
  novo jsonb,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 1000),
  autor_ref uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX indice_historico_agendamento ON historico_agendamento (agendamento_id, em);
CREATE TRIGGER preservar_historico_agendamento BEFORE UPDATE OR DELETE ON historico_agendamento
  FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_historico();

COMMIT;
