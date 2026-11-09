// US-083 (escalas de atendimento — o planejado) e US-084 (lacunas conforme a cobertura configurada).
import { Router } from "express";
import { z } from "zod";
import { audit, notFound } from "../../db/helpers.js";
import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../lib/httpError.js";
import { pageMeta, pageSchema } from "../../lib/paging.js";
import { asyncHandler } from "../../middleware/async.js";
import { requirePerm } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { calcularLacunas, dentroDaDisponibilidade, diaSemanaIso, horariosSobrepoem } from "../../grupo3/regras.js";
import { dia, especialidade, horario, idParam, uuid } from "../../grupo3/validacao.js";
import { listarDisponibilidades } from "./colaboradores.js";

const router = Router();

const VER = ["equipe.visualizar", "agenda.visualizar", "atendimento-clinico.visualizar"];
const MAX_DIAS = 62;
const opcional = (schema) => schema.nullish().transform((value) => value ?? null);
const intervaloHorario = [
  (b) => !b.horaInicio || !b.horaFim || b.horaFim > b.horaInicio,
  { message: "O fim precisa ser depois do início.", path: ["horaFim"] },
];

function erroCampo(path, message) {
  return new HttpError(422, "Dados inválidos", [{ path, message }]);
}

const selectSql = `
  SELECT e.id, e.especialidade, e.local, to_char(e.data, 'YYYY-MM-DD') AS data,
         to_char(e.hora_inicio, 'HH24:MI') AS hora_inicio, to_char(e.hora_fim, 'HH24:MI') AS hora_fim,
         e.situacao::text AS situacao, e.observacao, e.motivo_cancelamento, e.criado_em, e.atualizado_em,
         c.id AS colaborador_id, c.nome AS colaborador_nome, c.vinculo::text AS colaborador_vinculo
  FROM grupo3.escala e
  JOIN grupo3.colaborador c ON c.id = e.colaborador_id
`;

function paraEscala(row) {
  return {
    id: row.id,
    colaborador: { id: row.colaborador_id, nome: row.colaborador_nome, vinculo: row.colaborador_vinculo },
    especialidade: row.especialidade,
    local: row.local,
    data: row.data,
    horaInicio: row.hora_inicio,
    horaFim: row.hora_fim,
    situacao: row.situacao,
    observacao: row.observacao,
    motivoCancelamento: row.motivo_cancelamento,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

async function buscarEscala(id, db = prisma) {
  const rows = await db.$queryRawUnsafe(`${selectSql} WHERE e.id = $1::uuid`, id);
  return rows[0] ? paraEscala(rows[0]) : null;
}

function diasEntre(inicio, fim) {
  const dias = [];
  for (let d = new Date(`${inicio}T00:00:00Z`); d <= new Date(`${fim}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}

const periodoQuery = {
  inicio: dia.optional(),
  fim: dia.optional(),
};

async function resolverPeriodo(inicio, fim) {
  const hoje = (await prisma.$queryRaw`SELECT to_char((now() AT TIME ZONE grupo3.fuso_horario())::date, 'YYYY-MM-DD') AS hoje`)[0].hoje;
  const ini = inicio ?? hoje;
  // Sem fim informado: sete dias a partir do início.
  const final = fim ?? new Date(Date.parse(`${ini}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  if (final < ini) throw erroCampo("fim", "O fim precisa ser igual ou depois do início.");
  if (diasEntre(ini, final).length > MAX_DIAS) throw erroCampo("fim", `Período máximo de ${MAX_DIAS} dias.`);
  return { inicio: ini, fim: final };
}

// ---------- Cobertura necessária (US-084) ----------

const cobertura = z.object({
  especialidade,
  diaSemana: z.number().int().min(1).max(7),
  horaInicio: horario,
  horaFim: horario,
  quantidadeMinima: z.number().int().min(1).max(50),
}).refine(...intervaloHorario);

async function listarCobertura(db = prisma) {
  const rows = await db.$queryRaw`
    SELECT id, especialidade, dia_semana, to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
           to_char(hora_fim, 'HH24:MI') AS hora_fim, quantidade_minima
    FROM grupo3.cobertura_necessaria
    ORDER BY especialidade, dia_semana, hora_inicio
  `;
  return rows.map((row) => ({
    id: row.id,
    especialidade: row.especialidade,
    diaSemana: row.dia_semana,
    horaInicio: row.hora_inicio,
    horaFim: row.hora_fim,
    quantidadeMinima: row.quantidade_minima,
  }));
}

router.get("/escalas/cobertura-necessaria", requirePerm(...VER), asyncHandler(async (_req, res) => {
  res.json({ data: await listarCobertura() });
}));

// Substitui toda a configuração de cobertura.
router.put(
  "/escalas/cobertura-necessaria",
  requirePerm("equipe.administrar"),
  validate(z.object({ coberturas: z.array(cobertura).max(200) })),
  asyncHandler(async (req, res) => {
    const lista = req.body.coberturas;
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const [a, b] = [lista[i], lista[j]];
        if (a.especialidade === b.especialidade && a.diaSemana === b.diaSemana
          && horariosSobrepoem({ inicio: a.horaInicio, fim: a.horaFim }, { inicio: b.horaInicio, fim: b.horaFim })) {
          throw erroCampo(`coberturas.${j}`, "Faixa sobreposta para a mesma especialidade e dia.");
        }
      }
    }
    const data = await prisma.$transaction(async (tx) => {
      const anterior = await listarCobertura(tx);
      // Configuração vigente, não histórico: a versão anterior fica na auditoria.
      await tx.$executeRaw`DELETE FROM grupo3.cobertura_necessaria`;
      for (const c of lista) {
        await tx.$executeRaw`
          INSERT INTO grupo3.cobertura_necessaria (especialidade, dia_semana, hora_inicio, hora_fim, quantidade_minima)
          VALUES (${c.especialidade}, ${c.diaSemana}, ${c.horaInicio}::time, ${c.horaFim}::time, ${c.quantidadeMinima})
        `;
      }
      await audit(tx, {
        userId: req.user.id, action: "escala.cobertura", entity: "grupo3.cobertura_necessaria", entityId: null,
        payload: { resultado: "sucesso", anterior: anterior.map(({ id, ...resto }) => resto), novo: lista },
      });
      return listarCobertura(tx);
    });
    res.json({ data });
  }),
);

// ---------- Lacunas (US-084) ----------

router.get(
  "/escalas/lacunas",
  requirePerm(...VER),
  validate(z.object({ ...periodoQuery, especialidade: especialidade.optional() }), "query"),
  asyncHandler(async (req, res) => {
    const periodo = await resolverPeriodo(req.query.inicio, req.query.fim);
    const esp = req.query.especialidade ?? null;
    const coberturas = (await listarCobertura()).filter((c) => !esp || c.especialidade === esp);
    const turnos = await prisma.$queryRaw`
      SELECT to_char(e.data, 'YYYY-MM-DD') AS data, e.especialidade,
             to_char(e.hora_inicio, 'HH24:MI') AS inicio, to_char(e.hora_fim, 'HH24:MI') AS fim
      FROM grupo3.escala e
      JOIN grupo3.colaborador c ON c.id = e.colaborador_id
      WHERE e.data BETWEEN ${periodo.inicio}::date AND ${periodo.fim}::date
        AND e.situacao <> 'cancelada' AND c.status = 'ativo'
        AND (${esp}::text IS NULL OR e.especialidade = ${esp})
    `;
    const lacunas = [];
    for (const data of diasEntre(periodo.inicio, periodo.fim)) {
      const diaSemana = diaSemanaIso(data);
      for (const c of coberturas.filter((item) => item.diaSemana === diaSemana)) {
        const doDia = turnos.filter((t) => t.data === data && t.especialidade === c.especialidade);
        for (const lacuna of calcularLacunas({ inicio: c.horaInicio, fim: c.horaFim, minimo: c.quantidadeMinima }, doDia)) {
          lacunas.push({ data, diaSemana, especialidade: c.especialidade, ...lacuna });
        }
      }
    }
    res.json({
      periodo,
      coberturasConsideradas: coberturas.length,
      resumo: { lacunas: lacunas.length, profissionaisFaltando: lacunas.reduce((soma, l) => soma + l.faltam, 0) },
      data: lacunas,
    });
  }),
);

// ---------- Escalas (US-083) ----------

const corpoEscala = z.object({
  colaboradorId: uuid,
  especialidade: opcional(especialidade),
  local: z.string().trim().min(2).max(120),
  data: dia,
  horaInicio: horario,
  horaFim: horario,
  situacao: z.enum(["prevista", "confirmada"]).default("prevista"),
  observacao: opcional(z.string().trim().min(1).max(500)),
}).refine(...intervaloHorario);

async function prepararEscala(tx, b, ignorarId = null) {
  const colaboradores = await tx.$queryRaw`
    SELECT id, status::text AS status, especialidade FROM grupo3.colaborador WHERE id = ${b.colaboradorId}::uuid
  `;
  const colaborador = colaboradores[0];
  if (!colaborador) throw erroCampo("colaboradorId", "Colaborador não encontrado.");
  if (colaborador.status !== "ativo") throw erroCampo("colaboradorId", "Colaborador inativo.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`grupo3.escala:${b.colaboradorId}`}, 0))`;
  const sobrepostas = await tx.$queryRaw`
    SELECT id, local, to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fim, 'HH24:MI') AS hora_fim
    FROM grupo3.escala
    WHERE colaborador_id = ${b.colaboradorId}::uuid AND data = ${b.data}::date AND situacao <> 'cancelada'
      AND hora_inicio < ${b.horaFim}::time AND hora_fim > ${b.horaInicio}::time
      AND (${ignorarId}::uuid IS NULL OR id <> ${ignorarId}::uuid)
  `;
  if (sobrepostas.length) {
    throw new HttpError(409, "O colaborador já está escalado nesse horário.", {
      conflitos: sobrepostas.map((e) => ({ escalaId: e.id, local: e.local, horaInicio: e.hora_inicio, horaFim: e.hora_fim })),
    });
  }
  const avisos = [];
  const disponibilidades = (await listarDisponibilidades(b.colaboradorId, tx))
    .map((d) => ({ diaSemana: d.diaSemana, inicio: d.horaInicio, fim: d.horaFim }));
  const cabe = dentroDaDisponibilidade(disponibilidades, diaSemanaIso(b.data), b.horaInicio, b.horaFim);
  if (cabe === false) avisos.push({ codigo: "fora_da_disponibilidade", mensagem: "Turno fora da disponibilidade declarada pelo colaborador." });
  return { especialidade: b.especialidade ?? colaborador.especialidade, avisos };
}

// A restrição de exclusão do banco cobre gravações concorrentes que escaparem da checagem.
function traduzirExclusao(error) {
  if ((error?.meta?.code || error?.code) === "23P01") {
    return new HttpError(409, "O colaborador já está escalado nesse horário.");
  }
  return error;
}

router.get(
  "/escalas",
  requirePerm(...VER),
  validate(pageSchema.extend({
    ...periodoQuery,
    colaboradorId: uuid.optional(),
    especialidade: especialidade.optional(),
    situacao: z.enum(["prevista", "confirmada", "cancelada"]).optional(),
    local: z.string().trim().min(1).max(120).optional(),
  }), "query"),
  asyncHandler(async (req, res) => {
    const { page, limit, colaboradorId, especialidade: esp, situacao, local } = req.query;
    const periodo = await resolverPeriodo(req.query.inicio, req.query.fim);
    const rows = await prisma.$queryRawUnsafe(
      `${selectSql.replace("SELECT", "SELECT count(*) OVER()::int AS total,")}
       WHERE e.data BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR e.colaborador_id = $3::uuid)
         AND ($4::text IS NULL OR e.especialidade = $4)
         AND ($5::text IS NULL OR e.situacao::text = $5)
         AND ($6::text IS NULL OR lower(e.local) = lower($6))
       ORDER BY e.data, e.hora_inicio, c.nome LIMIT $7 OFFSET $8`,
      periodo.inicio, periodo.fim, colaboradorId ?? null, esp ?? null, situacao ?? null, local ?? null, limit, (page - 1) * limit,
    );
    res.json({ periodo, data: rows.map(paraEscala), meta: pageMeta(page, limit, rows[0]?.total ?? 0) });
  }),
);

router.get("/escalas/:id", requirePerm(...VER), validate(idParam, "params"), asyncHandler(async (req, res) => {
  const escala = await buscarEscala(req.params.id);
  if (!escala) notFound("Escala não encontrada.");
  res.json(escala);
}));

router.post(
  "/escalas",
  requirePerm("equipe.criar"),
  validate(corpoEscala),
  asyncHandler(async (req, res) => {
    const b = req.body;
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const { especialidade: esp, avisos } = await prepararEscala(tx, b);
        const rows = await tx.$queryRaw`
          INSERT INTO grupo3.escala (colaborador_id, especialidade, local, data, hora_inicio, hora_fim, situacao, observacao, criado_por_ref)
          VALUES (${b.colaboradorId}::uuid, ${esp}, ${b.local}, ${b.data}::date, ${b.horaInicio}::time, ${b.horaFim}::time,
                  ${b.situacao}::grupo3.situacao_escala, ${b.observacao}, ${req.user.ref}::uuid)
          RETURNING id
        `;
        await audit(tx, {
          userId: req.user.id, action: "escala.criar", entity: "grupo3.escala", entityId: rows[0].id,
          payload: { resultado: "sucesso", colaboradorId: b.colaboradorId, data: b.data, horaInicio: b.horaInicio, horaFim: b.horaFim },
        });
        return { escala: await buscarEscala(rows[0].id, tx), avisos };
      });
      res.status(201).json({ ...resultado.escala, avisos: resultado.avisos });
    } catch (error) {
      throw traduzirExclusao(error);
    }
  }),
);

router.put(
  "/escalas/:id",
  requirePerm("equipe.editar"),
  validate(idParam, "params"),
  validate(corpoEscala),
  asyncHandler(async (req, res) => {
    const b = req.body;
    try {
      const resultado = await prisma.$transaction(async (tx) => {
        const atual = await buscarEscala(req.params.id, tx);
        if (!atual) notFound("Escala não encontrada.");
        if (atual.situacao === "cancelada") throw new HttpError(409, "Escala cancelada não pode ser alterada.");
        const { especialidade: esp, avisos } = await prepararEscala(tx, b, atual.id);
        await tx.$executeRaw`
          UPDATE grupo3.escala
          SET colaborador_id = ${b.colaboradorId}::uuid, especialidade = ${esp}, local = ${b.local}, data = ${b.data}::date,
              hora_inicio = ${b.horaInicio}::time, hora_fim = ${b.horaFim}::time, situacao = ${b.situacao}::grupo3.situacao_escala,
              observacao = ${b.observacao}
          WHERE id = ${atual.id}::uuid
        `;
        await audit(tx, {
          userId: req.user.id, action: "escala.editar", entity: "grupo3.escala", entityId: atual.id,
          payload: {
            resultado: "sucesso",
            anterior: { colaboradorId: atual.colaborador.id, data: atual.data, horaInicio: atual.horaInicio, horaFim: atual.horaFim, local: atual.local },
            novo: { colaboradorId: b.colaboradorId, data: b.data, horaInicio: b.horaInicio, horaFim: b.horaFim, local: b.local },
          },
        });
        return { escala: await buscarEscala(atual.id, tx), avisos };
      });
      res.json({ ...resultado.escala, avisos: resultado.avisos });
    } catch (error) {
      throw traduzirExclusao(error);
    }
  }),
);

router.patch(
  "/escalas/:id/situacao",
  requirePerm("equipe.editar"),
  validate(idParam, "params"),
  validate(z.object({
    situacao: z.enum(["prevista", "confirmada", "cancelada"]),
    motivo: opcional(z.string().trim().min(3).max(500)),
  })),
  asyncHandler(async (req, res) => {
    const escala = await prisma.$transaction(async (tx) => {
      const atual = await buscarEscala(req.params.id, tx);
      if (!atual) notFound("Escala não encontrada.");
      if (atual.situacao === "cancelada") throw new HttpError(409, "Escala cancelada não pode ser alterada.");
      await tx.$executeRaw`
        UPDATE grupo3.escala
        SET situacao = ${req.body.situacao}::grupo3.situacao_escala,
            motivo_cancelamento = ${req.body.situacao === "cancelada" ? req.body.motivo : null}
        WHERE id = ${atual.id}::uuid
      `;
      await audit(tx, {
        userId: req.user.id, action: "escala.situacao", entity: "grupo3.escala", entityId: atual.id,
        payload: { resultado: "sucesso", anterior: atual.situacao, novo: req.body.situacao },
      });
      return buscarEscala(atual.id, tx);
    });
    res.json(escala);
  }),
);

export default router;
