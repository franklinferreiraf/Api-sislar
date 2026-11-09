// E07 — Agenda única: US-066, US-067, US-068, US-069, US-072, US-073.
import { Router } from "express";
import { z } from "zod";
import { audit, notFound } from "../../db/helpers.js";
import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../lib/httpError.js";
import { pageMeta, pageSchema } from "../../lib/paging.js";
import { asyncHandler } from "../../middleware/async.js";
import { requirePerm } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  buscarAgendamento,
  buscarConflitos,
  colaboradorDoUsuario,
  erroConflito,
  listarAgendamentos,
  listarHistorico,
  mascararLista,
  periodoAgenda,
  registrarHistorico,
  resumoAgenda,
  travarAgendamento,
  travarProfissional,
} from "../../grupo3/agenda.js";
import { buscarIdoso } from "../../grupo3/portas/idosos.js";
import { podeVerIdoso } from "../../grupo3/portas/prontuario.js";
import { calcularFim, exigeMotivo, mascarar, mascararHistorico, motivoValido, podeAlterar } from "../../grupo3/regras.js";
import {
  categoria,
  dataHora,
  dia,
  duracaoMin,
  idParam,
  idosoId,
  motivo,
  statusAgendamento,
  temPermissao,
  texto,
  uuid,
  validarIntervalo,
} from "../../grupo3/validacao.js";

const router = Router();

const filtrosQuery = pageSchema.extend({
  inicio: dataHora.optional(),
  fim: dataHora.optional(),
  profissionalId: uuid.optional(),
  idosoId: idosoId.optional(),
  tipoId: uuid.optional(),
  categoria: categoria.optional(),
  status: statusAgendamento.optional(),
});

const agendaQuery = z.object({
  visao: z.enum(["dia", "semana", "mes"]).default("semana"),
  data: dia.optional(),
  status: statusAgendamento.optional(),
});

function erroCampo(path, message) {
  return new HttpError(422, "Dados inválidos", [{ path, message }]);
}

async function carregarTipo(db, id) {
  const rows = await db.$queryRaw`
    SELECT id, nome, categoria::text AS categoria, duracao_padrao_min, permite_sobreposicao, ativo
    FROM grupo3.tipo_atendimento WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

async function carregarProfissional(db, id) {
  const rows = await db.$queryRaw`SELECT id, nome, status::text AS status FROM grupo3.colaborador WHERE id = ${id}::uuid`;
  return rows[0] ?? null;
}

async function exigirProfissionalAtivo(db, id, campo = "profissionalId") {
  const profissional = await carregarProfissional(db, id);
  if (!profissional) throw erroCampo(campo, "Profissional não encontrado.");
  if (profissional.status !== "ativo") throw erroCampo(campo, "Profissional inativo.");
  return profissional;
}

// Recusa por conflito também entra na auditoria (NFR-003: resultado da operação).
async function auditarRecusa(req, action, entityId, error) {
  if (error instanceof HttpError && error.status === 409 && error.details?.conflitos) {
    await audit(prisma, {
      userId: req.user.id, action, entity: "grupo3.agendamento", entityId,
      payload: { resultado: "recusado_conflito", conflitos: error.details.conflitos.map((c) => c.agendamentoId) },
    });
  }
}

// Acesso ao agendamento: permissão de agenda ou ser o profissional do próprio agendamento.
async function acessarAgendamento(req, id) {
  const agendamento = await buscarAgendamento(id);
  if (!agendamento) notFound("Agendamento não encontrado.");
  const colaborador = await colaboradorDoUsuario(req.user);
  const proprio = colaborador && agendamento.profissional.id === colaborador.id;
  if (!proprio && !temPermissao(req.user, "agenda.visualizar")) {
    throw new HttpError(403, "Você não tem autorização para esta ação.");
  }
  return { agendamento, colaborador };
}

// ---------- Consulta ----------

router.get(
  "/agendamentos",
  requirePerm("agenda.visualizar"),
  validate(filtrosQuery, "query"),
  asyncHandler(async (req, res) => {
    const { page, limit, idosoId: idosoParam, ...filtros } = req.query;
    validarIntervalo(filtros.inicio, filtros.fim);
    let idosoRef;
    if (idosoParam) {
      const idoso = await buscarIdoso(idosoParam);
      if (!idoso) return res.json({ data: [], meta: pageMeta(page, limit, 0) });
      idosoRef = idoso.ref;
    }
    const colaborador = await colaboradorDoUsuario(req.user);
    const { data, total } = await listarAgendamentos({ ...filtros, idosoRef }, { limit, offset: (page - 1) * limit });
    res.json({ data: mascararLista(data, req.user, colaborador?.id), meta: pageMeta(page, limit, total) });
  }),
);

router.get(
  "/agendamentos/:id",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { agendamento, colaborador } = await acessarAgendamento(req, req.params.id);
    res.json(mascarar(agendamento, req.user, colaborador?.id));
  }),
);

router.get(
  "/agendamentos/:id/historico",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { agendamento, colaborador } = await acessarAgendamento(req, req.params.id);
    const proprio = colaborador?.id === agendamento.profissional.id;
    const itens = await listarHistorico(agendamento.id);
    res.json({ data: itens.map((item) => mascararHistorico(item, agendamento.tipo.categoria, req.user, proprio)) });
  }),
);

async function agendaDoColaborador(req, res, colaborador) {
  const { visao, data, status } = req.query;
  const periodo = await periodoAgenda(visao, data ?? null);
  const { data: itens } = await listarAgendamentos({
    profissionalId: colaborador.id, inicio: periodo.inicio, fim: periodo.fim, status,
  });
  const visiveis = mascararLista(itens, req.user, (await colaboradorDoUsuario(req.user))?.id);
  res.json({
    colaborador: { id: colaborador.id, nome: colaborador.nome, vinculo: colaborador.vinculo },
    periodo: { visao, data: periodo.data, inicio: periodo.inicio, fim: periodo.fim, fuso: periodo.fuso },
    resumo: resumoAgenda(visiveis),
    data: visiveis,
  });
}

router.get(
  "/colaboradores/:id/agenda",
  requirePerm("agenda.visualizar"),
  validate(idParam, "params"),
  validate(agendaQuery, "query"),
  asyncHandler(async (req, res) => {
    const colaborador = await prisma.$queryRaw`
      SELECT id, nome, vinculo::text AS vinculo FROM grupo3.colaborador WHERE id = ${req.params.id}::uuid
    `;
    if (!colaborador[0]) notFound("Colaborador não encontrado.");
    await agendaDoColaborador(req, res, colaborador[0]);
  }),
);

// Qualquer usuário autenticado vê a própria agenda; o voluntário só tem esta visão (D-001).
router.get(
  "/me/agenda",
  validate(agendaQuery, "query"),
  asyncHandler(async (req, res) => {
    const colaborador = await colaboradorDoUsuario(req.user);
    if (!colaborador) notFound("Seu usuário não está vinculado a um colaborador da equipe.");
    await agendaDoColaborador(req, res, colaborador);
  }),
);

// US-072 — histórico de atendimentos do idoso.
router.get(
  "/idosos/:idosoId/atendimentos",
  requirePerm("agenda.visualizar"),
  validate(z.object({ idosoId }), "params"),
  validate(filtrosQuery.omit({ idosoId: true }), "query"),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filtros } = req.query;
    validarIntervalo(filtros.inicio, filtros.fim);
    const idoso = await buscarIdoso(req.params.idosoId);
    if (!idoso) notFound("Idoso não encontrado.");
    if (!(await podeVerIdoso(req.user, idoso))) throw new HttpError(403, "Você não tem autorização para esta ação.");
    const colaborador = await colaboradorDoUsuario(req.user);
    const { data, total } = await listarAgendamentos(
      { ...filtros, idosoRef: idoso.ref },
      { limit, offset: (page - 1) * limit, ordem: "desc" },
    );
    res.json({
      idoso: { id: idoso.id, nome: idoso.nome },
      data: mascararLista(data, req.user, colaborador?.id),
      meta: pageMeta(page, limit, total),
    });
  }),
);

// ---------- Conflitos (US-073) ----------

router.post(
  "/agendamentos/verificar-conflitos",
  requirePerm("agenda.criar", "agenda.editar"),
  validate(z.object({
    profissionalId: uuid,
    tipoId: uuid,
    inicio: dataHora,
    duracaoMin: duracaoMin.optional(),
    ignorarAgendamentoId: uuid.optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const tipo = await carregarTipo(prisma, b.tipoId);
    if (!tipo) throw erroCampo("tipoId", "Tipo de atendimento não encontrado.");
    const duracao = b.duracaoMin ?? tipo.duracao_padrao_min;
    const fim = calcularFim(b.inicio, duracao);
    const conflitos = await buscarConflitos(prisma, {
      profissionalId: b.profissionalId, tipoId: tipo.id, permiteSobreposicao: tipo.permite_sobreposicao,
      inicio: b.inicio, fim, ignorarId: b.ignorarAgendamentoId ?? null,
    });
    res.json({ temConflito: conflitos.length > 0, inicio: b.inicio, fim, conflitos });
  }),
);

// ---------- Escrita ----------

router.post(
  "/agendamentos",
  requirePerm("agenda.criar"),
  validate(z.object({
    idosoId,
    tipoId: uuid,
    profissionalId: uuid,
    inicio: dataHora,
    duracaoMin: duracaoMin.optional(),
    local: texto(120).nullish(),
    observacoes: texto(2000).nullish(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const idoso = await buscarIdoso(b.idosoId);
    if (!idoso) throw erroCampo("idosoId", "Idoso não encontrado.");
    if (!idoso.ativo) throw erroCampo("idosoId", "Idoso inativo.");
    let id;
    try {
      id = await prisma.$transaction(async (tx) => {
        const tipo = await carregarTipo(tx, b.tipoId);
        if (!tipo) throw erroCampo("tipoId", "Tipo de atendimento não encontrado.");
        if (!tipo.ativo) throw erroCampo("tipoId", "Tipo de atendimento inativo.");
        await exigirProfissionalAtivo(tx, b.profissionalId);
        const duracao = b.duracaoMin ?? tipo.duracao_padrao_min;
        const fim = calcularFim(b.inicio, duracao);
        await travarProfissional(tx, b.profissionalId);
        const conflitos = await buscarConflitos(tx, {
          profissionalId: b.profissionalId, tipoId: tipo.id, permiteSobreposicao: tipo.permite_sobreposicao,
          inicio: b.inicio, fim,
        });
        if (conflitos.length) throw erroConflito(conflitos);
        const rows = await tx.$queryRaw`
          INSERT INTO grupo3.agendamento (idoso_ref, tipo_id, profissional_id, inicio, duracao_min, local, observacoes, criado_por_ref)
          VALUES (${idoso.ref}::uuid, ${tipo.id}::uuid, ${b.profissionalId}::uuid, ${b.inicio}, ${duracao},
                  ${b.local ?? null}, ${b.observacoes ?? null}, ${req.user.ref}::uuid)
          RETURNING id
        `;
        const novoId = rows[0].id;
        await registrarHistorico(tx, {
          agendamentoId: novoId, acao: "criado", autorRef: req.user.ref,
          novo: { inicio: b.inicio, duracaoMin: duracao, profissionalId: b.profissionalId, tipoId: tipo.id, status: "agendado" },
        });
        await audit(tx, {
          userId: req.user.id, action: "agendamento.criar", entity: "grupo3.agendamento", entityId: novoId,
          payload: { resultado: "sucesso", tipoId: tipo.id, profissionalId: b.profissionalId, inicio: b.inicio },
        });
        return novoId;
      });
    } catch (error) {
      await auditarRecusa(req, "agendamento.criar", null, error);
      throw error;
    }
    res.status(201).json(await buscarAgendamento(id));
  }),
);

router.post(
  "/agendamentos/:id/reagendar",
  requirePerm("agenda.editar"),
  validate(idParam, "params"),
  validate(z.object({
    inicio: dataHora,
    duracaoMin: duracaoMin.optional(),
    profissionalId: uuid.optional(),
    motivo: motivo.optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    try {
      await prisma.$transaction(async (tx) => {
        const atual = await travarAgendamento(tx, req.params.id);
        if (!atual) notFound("Agendamento não encontrado.");
        if (!podeAlterar(atual.status)) throw new HttpError(409, `Agendamento ${atual.status.replace("_", " ")} não pode ser reagendado.`);
        if (exigeMotivo({ exigeMotivoReagendamento: atual.exige_motivo_reagendamento }, "reagendar") && !motivoValido(b.motivo)) {
          throw erroCampo("motivo", "Este tipo de atendimento exige motivo para reagendar.");
        }
        const profissionalId = b.profissionalId ?? atual.profissional_id;
        const duracao = b.duracaoMin ?? atual.duracao_min;
        const mudou = b.inicio.getTime() !== atual.inicio.getTime() || duracao !== atual.duracao_min || profissionalId !== atual.profissional_id;
        if (!mudou) throw erroCampo("inicio", "Informe nova data/hora, duração ou profissional.");
        if (profissionalId !== atual.profissional_id) await exigirProfissionalAtivo(tx, profissionalId);
        const fim = calcularFim(b.inicio, duracao);
        await travarProfissional(tx, profissionalId);
        const conflitos = await buscarConflitos(tx, {
          profissionalId, tipoId: atual.tipo_id, permiteSobreposicao: atual.permite_sobreposicao,
          inicio: b.inicio, fim, ignorarId: atual.id,
        });
        if (conflitos.length) throw erroConflito(conflitos);
        await tx.$executeRaw`
          UPDATE grupo3.agendamento
          SET inicio = ${b.inicio}, duracao_min = ${duracao}, profissional_id = ${profissionalId}::uuid
          WHERE id = ${atual.id}::uuid
        `;
        const anterior = { inicio: atual.inicio, duracaoMin: atual.duracao_min, profissionalId: atual.profissional_id };
        const novo = { inicio: b.inicio, duracaoMin: duracao, profissionalId };
        await registrarHistorico(tx, { agendamentoId: atual.id, acao: "reagendado", anterior, novo, motivo: b.motivo ?? null, autorRef: req.user.ref });
        await audit(tx, {
          userId: req.user.id, action: "agendamento.reagendar", entity: "grupo3.agendamento", entityId: atual.id,
          payload: { resultado: "sucesso", anterior, novo },
        });
      });
    } catch (error) {
      await auditarRecusa(req, "agendamento.reagendar", req.params.id, error);
      throw error;
    }
    const colaborador = await colaboradorDoUsuario(req.user);
    res.json(mascarar(await buscarAgendamento(req.params.id), req.user, colaborador?.id));
  }),
);

router.post(
  "/agendamentos/:id/cancelar",
  requirePerm("agenda.editar"),
  validate(idParam, "params"),
  validate(z.object({ motivo: motivo.optional() })),
  asyncHandler(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const atual = await travarAgendamento(tx, req.params.id);
      if (!atual) notFound("Agendamento não encontrado.");
      if (!podeAlterar(atual.status)) throw new HttpError(409, `Agendamento ${atual.status.replace("_", " ")} não pode ser cancelado.`);
      if (exigeMotivo({ exigeMotivoCancelamento: atual.exige_motivo_cancelamento }, "cancelar") && !motivoValido(req.body.motivo)) {
        throw erroCampo("motivo", "Este tipo de atendimento exige motivo para cancelar.");
      }
      await tx.$executeRaw`
        UPDATE grupo3.agendamento
        SET status = 'cancelado', motivo_status = ${req.body.motivo ?? null}, concluido_em = now()
        WHERE id = ${atual.id}::uuid
      `;
      await registrarHistorico(tx, {
        agendamentoId: atual.id, acao: "cancelado", anterior: { status: "agendado" }, novo: { status: "cancelado" },
        motivo: req.body.motivo ?? null, autorRef: req.user.ref,
      });
      await audit(tx, {
        userId: req.user.id, action: "agendamento.cancelar", entity: "grupo3.agendamento", entityId: atual.id,
        payload: { resultado: "sucesso" },
      });
    });
    const colaborador = await colaboradorDoUsuario(req.user);
    res.json(mascarar(await buscarAgendamento(req.params.id), req.user, colaborador?.id));
  }),
);

// US-069 — realizado / não realizado, com responsável e observação.
router.post(
  "/agendamentos/:id/realizacao",
  requirePerm("agenda.editar"),
  validate(idParam, "params"),
  validate(z.object({
    status: z.enum(["realizado", "nao_realizado"]),
    responsavelId: uuid.optional(),
    observacao: texto(2000).nullish(),
  })),
  asyncHandler(async (req, res) => {
    const b = req.body;
    await prisma.$transaction(async (tx) => {
      const atual = await travarAgendamento(tx, req.params.id);
      if (!atual) notFound("Agendamento não encontrado.");
      if (!podeAlterar(atual.status)) throw new HttpError(409, `Agendamento já está ${atual.status.replace("_", " ")}.`);
      if (atual.inicio.getTime() > Date.now()) throw erroCampo("status", "Não é possível registrar a realização antes do horário de início.");
      let responsavelId = b.responsavelId;
      if (responsavelId) {
        if (!(await carregarProfissional(tx, responsavelId))) throw erroCampo("responsavelId", "Responsável não encontrado.");
      } else {
        responsavelId = (await colaboradorDoUsuario(req.user, tx))?.id ?? atual.profissional_id;
      }
      await tx.$executeRaw`
        UPDATE grupo3.agendamento
        SET status = ${b.status}::grupo3.status_agendamento, responsavel_realizacao_id = ${responsavelId}::uuid,
            observacao_realizacao = ${b.observacao ?? null}, concluido_em = now()
        WHERE id = ${atual.id}::uuid
      `;
      await registrarHistorico(tx, {
        agendamentoId: atual.id, acao: b.status, anterior: { status: "agendado" },
        novo: { status: b.status, responsavelId, observacaoRealizacao: b.observacao ?? null }, autorRef: req.user.ref,
      });
      await audit(tx, {
        userId: req.user.id, action: `agendamento.${b.status}`, entity: "grupo3.agendamento", entityId: atual.id,
        payload: { resultado: "sucesso", responsavelId },
      });
    });
    const colaborador = await colaboradorDoUsuario(req.user);
    res.json(mascarar(await buscarAgendamento(req.params.id), req.user, colaborador?.id));
  }),
);

export default router;
