// OpenAPI do Grupo 3 — Agenda, atendimentos e profissionais. Juntado em openapi.js.

const uuid = { type: "string", format: "uuid" };
const dataHora = { type: "string", format: "date-time", example: "2026-11-10T14:00:00-03:00" };
const idosoId = { type: "string", pattern: "^[A-Za-z0-9_-]+$", example: "p02" };
const categoria = {
  type: "string",
  enum: ["consulta_medica", "consulta_odontologica", "fisioterapia", "cuidado_pessoal", "farmacia", "avaliacao", "outro"],
};
const statusAgendamento = { type: "string", enum: ["agendado", "realizado", "nao_realizado", "cancelado"] };

const path = (name, schema = uuid) => ({ name, in: "path", required: true, schema });
const query = (name, schema, description) => ({ name, in: "query", required: false, schema, ...(description ? { description } : {}) });
const pagina = [
  query("page", { type: "integer", minimum: 1, default: 1 }),
  query("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }),
];

const erro = (message, details = null) => ({ error: { message, details } });
const ERROS = {
  401: { $ref: "#/components/responses/NaoAutenticado" },
  403: { $ref: "#/components/responses/SemPermissao" },
  404: { $ref: "#/components/responses/NaoEncontrado" },
  409: { $ref: "#/components/responses/Conflito" },
  422: { $ref: "#/components/responses/Invalido" },
};

function op(tag, summary, perm, extras = {}) {
  const status = String(extras.status || 200);
  const operation = {
    tags: [tag],
    summary,
    description: [perm ? `Permissão: \`${perm}\`.` : "Exige sessão autenticada.", extras.description].filter(Boolean).join("\n\n"),
    security: [{ bearerAuth: [] }],
    responses: {
      [status]: {
        description: status === "201" ? "Criado." : "Sucesso.",
        content: { "application/json": { schema: extras.schema || { type: "object", additionalProperties: true }, ...(extras.example ? { example: extras.example } : {}) } },
      },
      401: ERROS[401],
      403: ERROS[403],
      422: ERROS[422],
    },
  };
  for (const code of extras.errors || []) operation.responses[code] = ERROS[code];
  if (extras.conflictExample) {
    operation.responses[409] = {
      description: "Conflito de agenda ou estado atual impede a operação.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" }, example: extras.conflictExample } },
    };
  }
  const parameters = [...(extras.params || []), ...(extras.query || [])];
  if (parameters.length) operation.parameters = parameters;
  if (extras.body) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: extras.body, ...(extras.bodyExample ? { example: extras.bodyExample } : {}) } },
    };
  }
  return operation;
}

// ---------- Exemplos ----------

const exemploTipo = {
  id: "0b7f9a64-3f1e-4c55-9f0a-0d6f3b1f6a10",
  nome: "Fisioterapia em grupo",
  categoria: "fisioterapia",
  descricao: null,
  duracaoPadraoMin: 60,
  exigeMotivoCancelamento: true,
  exigeMotivoReagendamento: false,
  permiteSobreposicao: true,
  ativo: true,
  criadoEm: "2026-11-09T12:00:00.000Z",
  atualizadoEm: "2026-11-09T12:00:00.000Z",
};

const exemploColaborador = {
  id: "5d2c8f0e-8a7b-4b8e-9b61-7c3f3e2a1b00",
  nome: "Renata Gouveia",
  vinculo: "funcionario",
  status: "ativo",
  usuario: { id: "s06", nome: "Renata Gouveia" },
  criadoEm: "2026-11-09T12:00:00.000Z",
  atualizadoEm: "2026-11-09T12:00:00.000Z",
};

const exemploAgendamento = {
  id: "9a1c6e1e-2f43-4d0b-8a8e-1f0c2b3d4e5f",
  idoso: { id: "p02", nome: "Antônio Pereira" },
  tipo: { id: exemploTipo.id, nome: "Sessão de fisioterapia", categoria: "fisioterapia" },
  profissional: { id: exemploColaborador.id, nome: "Renata Gouveia" },
  inicio: "2026-11-10T17:00:00.000Z",
  fim: "2026-11-10T17:40:00.000Z",
  duracaoMin: 40,
  local: "Sala de fisioterapia",
  observacoes: "Treino de marcha com andador.",
  status: "agendado",
  motivoStatus: null,
  responsavelRealizacao: null,
  observacaoRealizacao: null,
  concluidoEm: null,
  criadoEm: "2026-11-09T12:00:00.000Z",
  atualizadoEm: "2026-11-09T12:00:00.000Z",
  emConflito: false,
};

const exemploConflito = erro("O profissional já tem agendamento nesse horário.", {
  conflitos: [{
    agendamentoId: "1f2e3d4c-5b6a-4789-8a0b-1c2d3e4f5a6b",
    tipo: { id: exemploTipo.id, nome: "Sessão de fisioterapia" },
    inicio: "2026-11-10T17:00:00.000Z",
    fim: "2026-11-10T17:40:00.000Z",
  }],
});

const lista = (item) => ({ data: [item], meta: { page: 1, limit: 20, total: 1, pages: 1 } });

// ---------- Corpos ----------

const corpoTipo = {
  type: "object",
  required: ["nome", "categoria", "duracaoPadraoMin"],
  properties: {
    nome: { type: "string", minLength: 2, maxLength: 120 },
    categoria,
    descricao: { type: "string", maxLength: 1000, nullable: true },
    duracaoPadraoMin: { type: "integer", minimum: 5, maximum: 720 },
    exigeMotivoCancelamento: { type: "boolean", default: true },
    exigeMotivoReagendamento: { type: "boolean", default: true },
    permiteSobreposicao: {
      type: "boolean",
      default: false,
      description: "Permite sobrepor apenas agendamentos do MESMO tipo (ex.: atendimento em grupo).",
    },
  },
};

const corpoColaborador = {
  type: "object",
  required: ["nome", "vinculo"],
  properties: {
    nome: { type: "string", minLength: 3, maxLength: 160 },
    vinculo: { type: "string", enum: ["funcionario", "voluntario", "externo"] },
    usuarioId: { type: "string", nullable: true, description: "Usuário do sistema (opcional). Um usuário vincula a um só colaborador." },
  },
};

const filtrosAgenda = [
  query("inicio", dataHora, "Agendamentos que terminam depois deste instante."),
  query("fim", dataHora, "Agendamentos que começam antes deste instante."),
  query("profissionalId", uuid),
  query("tipoId", uuid),
  query("categoria", categoria),
  query("status", statusAgendamento),
];

const visaoAgenda = [
  query("visao", { type: "string", enum: ["dia", "semana", "mes"], default: "semana" }),
  query("data", { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", example: "2026-11-10" }, "Dia de referência no fuso da instituição. Padrão: hoje."),
  query("status", statusAgendamento),
];

const exemploAgenda = {
  colaborador: { id: exemploColaborador.id, nome: "Renata Gouveia", vinculo: "funcionario" },
  periodo: { visao: "dia", data: "2026-11-10", inicio: "2026-11-10T03:00:00.000Z", fim: "2026-11-11T03:00:00.000Z", fuso: "America/Sao_Paulo" },
  resumo: { total: 1, agendado: 1, realizado: 0, nao_realizado: 0, cancelado: 0, emConflito: 0 },
  data: [exemploAgendamento],
};

const lgpd = "Em consultas, fisioterapia e avaliações, `observacoes`, `motivoStatus` e `observacaoRealizacao` voltam `null` "
  + "com `conteudoRestrito: true` para quem não tem a permissão clínica (`atendimento-clinico.visualizar` ou "
  + "`fisioterapia.visualizar`), exceto o próprio profissional do agendamento.";

export const tagsGrupo3 = [
  { name: "G3 · Tipos de atendimento", description: "US-065. Tipos e serviços da agenda única." },
  { name: "G3 · Agenda", description: "US-066 a US-073. Agendamentos, conflitos, reagendamento, cancelamento e realização." },
  { name: "G3 · Equipe", description: "Cadastro único de colaboradores (mínimo da Fatia 1)." },
];

export const pathsGrupo3 = {
  "/api/tipos-atendimento": {
    get: op("G3 · Tipos de atendimento", "Listar tipos de atendimento", "agenda.visualizar", {
      query: [...pagina, query("categoria", categoria), query("ativo", { type: "boolean" })],
      example: lista(exemploTipo),
    }),
    post: op("G3 · Tipos de atendimento", "Criar tipo de atendimento", "agenda.administrar", {
      status: 201,
      body: corpoTipo,
      bodyExample: { nome: "Fisioterapia em grupo", categoria: "fisioterapia", duracaoPadraoMin: 60, permiteSobreposicao: true, exigeMotivoReagendamento: false },
      example: exemploTipo,
      conflictExample: erro("Já existe um tipo de atendimento com esse nome."),
    }),
  },
  "/api/tipos-atendimento/{id}": {
    get: op("G3 · Tipos de atendimento", "Detalhe do tipo", "agenda.visualizar", { params: [path("id")], errors: [404], example: exemploTipo }),
    put: op("G3 · Tipos de atendimento", "Editar tipo", "agenda.administrar", {
      params: [path("id")], body: corpoTipo, errors: [404], example: exemploTipo,
      conflictExample: erro("Já existe um tipo de atendimento com esse nome."),
    }),
  },
  "/api/tipos-atendimento/{id}/status": {
    patch: op("G3 · Tipos de atendimento", "Ativar ou inativar tipo", "agenda.administrar", {
      params: [path("id")],
      body: { type: "object", required: ["ativo"], properties: { ativo: { type: "boolean" } } },
      bodyExample: { ativo: false },
      errors: [404],
      example: { ...exemploTipo, ativo: false },
      description: "Tipo inativo não aceita novos agendamentos; os existentes são preservados.",
    }),
  },

  "/api/colaboradores": {
    get: op("G3 · Equipe", "Listar colaboradores", "equipe.visualizar, agenda.criar ou agenda.editar", {
      query: [...pagina, query("vinculo", { type: "string", enum: ["funcionario", "voluntario", "externo"] }), query("status", { type: "string", enum: ["ativo", "inativo"] }), query("q", { type: "string", maxLength: 80 })],
      example: lista(exemploColaborador),
    }),
    post: op("G3 · Equipe", "Cadastrar colaborador", "equipe.criar", {
      status: 201, body: corpoColaborador,
      bodyExample: { nome: "Renata Gouveia", vinculo: "funcionario", usuarioId: "s06" },
      example: exemploColaborador,
      conflictExample: erro("Este usuário já está vinculado a outro colaborador."),
    }),
  },
  "/api/colaboradores/{id}": {
    get: op("G3 · Equipe", "Detalhe do colaborador", "equipe.visualizar, agenda.criar ou agenda.editar", { params: [path("id")], errors: [404], example: exemploColaborador }),
    put: op("G3 · Equipe", "Editar colaborador", "equipe.editar", {
      params: [path("id")], body: corpoColaborador, errors: [404], example: exemploColaborador,
      conflictExample: erro("Este usuário já está vinculado a outro colaborador."),
    }),
  },
  "/api/colaboradores/{id}/status": {
    patch: op("G3 · Equipe", "Ativar ou inativar colaborador", "equipe.excluir", {
      params: [path("id")],
      body: { type: "object", required: ["status"], properties: { status: { type: "string", enum: ["ativo", "inativo"] } } },
      bodyExample: { status: "inativo" },
      errors: [404],
      example: { ...exemploColaborador, status: "inativo" },
      description: "Não há exclusão física. Colaborador inativo não recebe novos agendamentos.",
    }),
  },
  "/api/colaboradores/{id}/agenda": {
    get: op("G3 · Agenda", "Agenda do profissional (dia, semana ou mês)", "agenda.visualizar", {
      params: [path("id")], query: visaoAgenda, errors: [404], example: exemploAgenda,
      description: `A semana vai de segunda a domingo, no fuso da instituição. ${lgpd}`,
    }),
  },
  "/api/me/agenda": {
    get: op("G3 · Agenda", "Minha agenda", null, {
      query: visaoAgenda, errors: [404], example: exemploAgenda,
      description: "Agenda do colaborador vinculado ao usuário logado. É a única visão de agenda do voluntário. 404 se o usuário não tiver colaborador vinculado.",
    }),
  },

  "/api/agendamentos": {
    get: op("G3 · Agenda", "Listar agendamentos (calendário)", "agenda.visualizar", {
      query: [...pagina, ...filtrosAgenda, query("idosoId", idosoId)],
      example: lista(exemploAgendamento),
      description: `Agenda única: consultas, fisioterapia, cuidados pessoais, farmácia e avaliações. \`emConflito\` indica sobreposição com outro agendamento ativo do mesmo profissional. ${lgpd}`,
    }),
    post: op("G3 · Agenda", "Agendar atendimento", "agenda.criar", {
      status: 201,
      body: {
        type: "object",
        required: ["idosoId", "tipoId", "profissionalId", "inicio"],
        properties: {
          idosoId,
          tipoId: uuid,
          profissionalId: uuid,
          inicio: dataHora,
          duracaoMin: { type: "integer", minimum: 5, maximum: 720, description: "Padrão: duração do tipo." },
          local: { type: "string", maxLength: 120, nullable: true },
          observacoes: { type: "string", maxLength: 2000, nullable: true },
        },
      },
      bodyExample: { idosoId: "p02", tipoId: exemploTipo.id, profissionalId: exemploColaborador.id, inicio: "2026-11-10T14:00:00-03:00", local: "Sala de fisioterapia", observacoes: "Treino de marcha com andador." },
      example: exemploAgendamento,
      conflictExample: exemploConflito,
      description: "Valida idoso, tipo ativo e profissional ativo. Recusa com 409 e a lista de conflitos se o profissional já tiver agendamento ativo sobreposto (exceto mesmo tipo com sobreposição permitida).",
    }),
  },
  "/api/agendamentos/verificar-conflitos": {
    post: op("G3 · Agenda", "Verificar conflitos antes de confirmar", "agenda.criar ou agenda.editar", {
      body: {
        type: "object",
        required: ["profissionalId", "tipoId", "inicio"],
        properties: {
          profissionalId: uuid, tipoId: uuid, inicio: dataHora,
          duracaoMin: { type: "integer", minimum: 5, maximum: 720 },
          ignorarAgendamentoId: { ...uuid, description: "Use no reagendamento para não conflitar consigo mesmo." },
        },
      },
      bodyExample: { profissionalId: exemploColaborador.id, tipoId: exemploTipo.id, inicio: "2026-11-10T14:20:00-03:00" },
      example: { temConflito: true, inicio: "2026-11-10T17:20:00.000Z", fim: "2026-11-10T18:00:00.000Z", conflitos: exemploConflito.error.details.conflitos },
    }),
  },
  "/api/agendamentos/{id}": {
    get: op("G3 · Agenda", "Detalhe do agendamento", "agenda.visualizar (ou ser o profissional do agendamento)", {
      params: [path("id")], errors: [404], example: exemploAgendamento, description: lgpd,
    }),
  },
  "/api/agendamentos/{id}/reagendar": {
    post: op("G3 · Agenda", "Reagendar", "agenda.editar", {
      params: [path("id")],
      body: {
        type: "object",
        required: ["inicio"],
        properties: {
          inicio: dataHora,
          duracaoMin: { type: "integer", minimum: 5, maximum: 720 },
          profissionalId: uuid,
          motivo: { type: "string", minLength: 3, maxLength: 1000, description: "Obrigatório quando o tipo exige motivo para reagendar." },
        },
      },
      bodyExample: { inicio: "2026-11-11T09:00:00-03:00", motivo: "Atraso do transporte" },
      errors: [404],
      example: { ...exemploAgendamento, inicio: "2026-11-11T12:00:00.000Z", fim: "2026-11-11T12:40:00.000Z" },
      conflictExample: exemploConflito,
      description: "Mantém o mesmo registro e grava anterior → novo no histórico. Revalida conflito ignorando o próprio agendamento. 409 também quando o agendamento já foi encerrado.",
    }),
  },
  "/api/agendamentos/{id}/cancelar": {
    post: op("G3 · Agenda", "Cancelar", "agenda.editar", {
      params: [path("id")],
      body: { type: "object", properties: { motivo: { type: "string", minLength: 3, maxLength: 1000 } } },
      bodyExample: { motivo: "Idoso hospitalizado" },
      errors: [404, 409],
      example: { ...exemploAgendamento, status: "cancelado", motivoStatus: "Idoso hospitalizado", concluidoEm: "2026-11-09T15:00:00.000Z" },
      description: "Sem exclusão física. Motivo obrigatório quando o tipo exige. Cancelado libera o horário.",
    }),
  },
  "/api/agendamentos/{id}/realizacao": {
    post: op("G3 · Agenda", "Registrar realização", "agenda.editar", {
      params: [path("id")],
      body: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["realizado", "nao_realizado"] },
          responsavelId: { ...uuid, description: "Padrão: colaborador do usuário logado; sem vínculo, o profissional do agendamento." },
          observacao: { type: "string", maxLength: 2000, nullable: true },
        },
      },
      bodyExample: { status: "realizado", observacao: "Caminhada de 15 minutos sem dor." },
      errors: [404, 409],
      example: {
        ...exemploAgendamento, status: "realizado", responsavelRealizacao: { id: exemploColaborador.id, nome: "Renata Gouveia" },
        observacaoRealizacao: "Caminhada de 15 minutos sem dor.", concluidoEm: "2026-11-10T17:45:00.000Z",
      },
      description: "Só depois do horário de início e uma única vez (422 antes do início, 409 se já encerrado).",
    }),
  },
  "/api/agendamentos/{id}/historico": {
    get: op("G3 · Agenda", "Histórico de alterações do agendamento", "agenda.visualizar (ou ser o profissional do agendamento)", {
      params: [path("id")], errors: [404],
      example: {
        data: [
          { id: "c1", acao: "criado", anterior: null, novo: { status: "agendado" }, motivo: null, em: "2026-11-09T12:00:00.000Z", autor: { id: "s09", nome: "Aline Barros" } },
          { id: "c2", acao: "reagendado", anterior: { inicio: "2026-11-10T17:00:00.000Z", duracaoMin: 40, profissionalId: exemploColaborador.id }, novo: { inicio: "2026-11-11T12:00:00.000Z", duracaoMin: 40, profissionalId: exemploColaborador.id }, motivo: "Atraso do transporte", em: "2026-11-09T13:00:00.000Z", autor: { id: "s09", nome: "Aline Barros" } },
        ],
      },
      description: "Histórico imutável (gatilho no banco).",
    }),
  },
  "/api/idosos/{idosoId}/atendimentos": {
    get: op("G3 · Agenda", "Histórico de atendimentos do idoso", "agenda.visualizar", {
      params: [path("idosoId", idosoId)],
      query: [...pagina, ...filtrosAgenda],
      errors: [404],
      example: { idoso: { id: "p02", nome: "Antônio Pereira" }, ...lista({ ...exemploAgendamento, status: "realizado" }) },
      description: `Do mais recente ao mais antigo. Integra os registros da agenda do Grupo 3; a linha do tempo do prontuário (Grupo 1) fica atrás da porta de integração. ${lgpd}`,
    }),
  },
};
