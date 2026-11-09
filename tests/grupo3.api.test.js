import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { prepare, shutdown } from "./prepare.js";

const password = "Sislar@2026";
const sessoes = {};
const EMAILS = {
  admin: "marta.lima@lardoirmaovelho.example",
  gestor: "ricardo.teixeira@lardoirmaovelho.example",
  tecnico: "joana.rocha@lardoirmaovelho.example",
  medico: "paulo.ferraz@lardoirmaovelho.example",
  fisio: "renata.gouveia@lardoirmaovelho.example",
  recepcao: "aline.barros@lardoirmaovelho.example",
  voluntaria: "helena.duarte@lardoirmaovelho.example",
};

async function como(perfil) {
  if (!sessoes[perfil]) {
    const response = await request(app).post("/api/auth/login").send({ email: EMAILS[perfil], password });
    assert.equal(response.status, 200);
    sessoes[perfil] = { Authorization: `Bearer ${response.body.token}` };
  }
  return sessoes[perfil];
}

const get = async (perfil, url) => request(app).get(url).set(await como(perfil));
const post = async (perfil, url, body) => request(app).post(url).set(await como(perfil)).send(body);

// Datas fixas fora do intervalo do seed, no fuso da instituição.
const em = (dia, hora) => `2030-03-${dia}T${hora}:00-03:00`;

let profissional;
let individual;
let grupo;

before(async () => {
  await prepare();
  const colaborador = await post("gestor", "/api/colaboradores", { nome: "Profissional de teste", vinculo: "funcionario" });
  assert.equal(colaborador.status, 201);
  profissional = colaborador.body.id;
  const tipoA = await post("admin", "/api/tipos-atendimento", {
    nome: "Teste individual", categoria: "avaliacao", duracaoPadraoMin: 30,
  });
  const tipoB = await post("admin", "/api/tipos-atendimento", {
    nome: "Teste em grupo", categoria: "fisioterapia", duracaoPadraoMin: 60, permiteSobreposicao: true,
    exigeMotivoCancelamento: false, exigeMotivoReagendamento: false,
  });
  assert.equal(tipoA.status, 201);
  assert.equal(tipoB.status, 201);
  individual = tipoA.body.id;
  grupo = tipoB.body.id;
});

after(async () => {
  await shutdown();
});

function agendar(perfil, extra) {
  return post(perfil, "/api/agendamentos", { idosoId: "p01", tipoId: individual, profissionalId: profissional, ...extra });
}

describe("grupo3 · documentação", () => {
  it("publica as rotas do G3 e marca a agenda legada como obsoleta", async () => {
    const spec = (await request(app).get("/api/openapi.json")).body;
    assert.equal(spec.paths["/api/agendamentos"].post.summary, "Agendar atendimento");
    assert.ok(spec.paths["/api/agendamentos"].post.responses["409"].content["application/json"].example.error.details.conflitos);
    assert.ok(spec.paths["/api/idosos/{idosoId}/atendimentos"].get);
    assert.equal(spec.paths["/api/agenda"].get.deprecated, true);
    assert.equal(spec.paths["/api/agenda"].post.deprecated, true);
    assert.equal(spec.paths["/api/atendimentos"].post.deprecated, true);
    assert.equal(spec.paths["/api/funcionarios"].get.deprecated, true);
  });
});

describe("grupo3 · tipos de atendimento (US-065)", () => {
  it("cria com regras configuráveis e recusa nome repetido", async () => {
    const tipo = await get("recepcao", `/api/tipos-atendimento/${grupo}`);
    assert.equal(tipo.status, 200);
    assert.equal(tipo.body.permiteSobreposicao, true);
    assert.equal(tipo.body.exigeMotivoCancelamento, false);
    const repetido = await post("admin", "/api/tipos-atendimento", { nome: "teste INDIVIDUAL", categoria: "outro", duracaoPadraoMin: 10 });
    assert.equal(repetido.status, 409);
  });

  it("só quem administra a agenda cria tipos", async () => {
    const response = await post("recepcao", "/api/tipos-atendimento", { nome: "Podologia", categoria: "cuidado_pessoal", duracaoPadraoMin: 30 });
    assert.equal(response.status, 403);
    const lista = await get("recepcao", "/api/tipos-atendimento?categoria=cuidado_pessoal");
    assert.equal(lista.status, 200);
    assert.ok(lista.body.data.length >= 3);
    assert.ok(lista.body.data.every((item) => item.categoria === "cuidado_pessoal"));
  });

  it("tipo inativo não aceita novo agendamento", async () => {
    const criado = await post("admin", "/api/tipos-atendimento", { nome: "Tipo a inativar", categoria: "outro", duracaoPadraoMin: 15 });
    const inativo = await request(app).patch(`/api/tipos-atendimento/${criado.body.id}/status`).set(await como("admin")).send({ ativo: false });
    assert.equal(inativo.body.ativo, false);
    const response = await agendar("recepcao", { tipoId: criado.body.id, inicio: em("20", "08:00") });
    assert.equal(response.status, 422);
  });
});

describe("grupo3 · agendar e conflitos (US-067, US-073)", () => {
  it("agenda com duração padrão do tipo e grava histórico", async () => {
    const response = await agendar("recepcao", { inicio: em("12", "10:00"), local: "Sala 2", observacoes: "Primeira avaliação" });
    assert.equal(response.status, 201);
    assert.equal(response.body.status, "agendado");
    assert.equal(response.body.duracaoMin, 30);
    assert.equal(new Date(response.body.fim).toISOString(), "2030-03-12T13:30:00.000Z");
    assert.equal(response.body.idoso.id, "p01");
    const historico = await get("gestor", `/api/agendamentos/${response.body.id}/historico`);
    assert.equal(historico.body.data[0].acao, "criado");
  });

  it("recusa sobreposição com 409 e lista os conflitos", async () => {
    const response = await agendar("recepcao", { inicio: em("12", "10:15") });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.details.conflitos.length, 1);
    const verificacao = await post("recepcao", "/api/agendamentos/verificar-conflitos", {
      profissionalId: profissional, tipoId: individual, inicio: em("12", "10:29"),
    });
    assert.equal(verificacao.status, 200);
    assert.equal(verificacao.body.temConflito, true);
    const recusa = await prisma.audit_log.findFirst({ where: { action: "agendamento.criar", payload: { path: ["resultado"], equals: "recusado_conflito" } } });
    assert.ok(recusa);
  });

  it("aceita horário encostado no fim do anterior", async () => {
    const response = await agendar("recepcao", { inicio: em("12", "10:30") });
    assert.equal(response.status, 201);
  });

  it("mesmo tipo com sobreposição permitida aceita; tipo diferente não", async () => {
    const a = await agendar("recepcao", { tipoId: grupo, inicio: em("13", "09:00") });
    const b = await agendar("recepcao", { tipoId: grupo, idosoId: "p02", inicio: em("13", "09:00") });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const individualNoGrupo = await agendar("recepcao", { inicio: em("13", "09:30") });
    assert.equal(individualNoGrupo.status, 409);
    const individualAntes = await agendar("recepcao", { inicio: em("13", "14:00") });
    const grupoSobreIndividual = await agendar("recepcao", { tipoId: grupo, inicio: em("13", "13:30") });
    assert.equal(individualAntes.status, 201);
    assert.equal(grupoSobreIndividual.status, 409);
  });

  it("duas gravações simultâneas no mesmo horário: só uma passa", async () => {
    const respostas = await Promise.all([
      agendar("recepcao", { inicio: em("19", "10:00") }),
      agendar("gestor", { idosoId: "p03", inicio: em("19", "10:00") }),
    ]);
    assert.deepEqual(respostas.map((item) => item.status).sort(), [201, 409]);
  });

  it("valida idoso, profissional e formato de data", async () => {
    assert.equal((await agendar("recepcao", { idosoId: "nao-existe", inicio: em("14", "10:00") })).status, 422);
    assert.equal((await agendar("recepcao", { inicio: "2030-03-14 10:00" })).status, 422);
    assert.equal((await agendar("recepcao", { inicio: em("14", "10:00"), duracaoMin: 2 })).status, 422);
  });
});

describe("grupo3 · reagendar, cancelar e realizar (US-068, US-069)", () => {
  it("reagenda sem conflitar consigo mesmo e recusa horário ocupado", async () => {
    const alvo = await agendar("recepcao", { inicio: em("15", "10:00") });
    await agendar("recepcao", { inicio: em("15", "11:00") });
    const semMotivo = await post("recepcao", `/api/agendamentos/${alvo.body.id}/reagendar`, { inicio: em("15", "10:10") });
    assert.equal(semMotivo.status, 422);
    const ok = await post("recepcao", `/api/agendamentos/${alvo.body.id}/reagendar`, { inicio: em("15", "10:10"), motivo: "Atraso do transporte" });
    assert.equal(ok.status, 200);
    assert.equal(new Date(ok.body.inicio).toISOString(), "2030-03-15T13:10:00.000Z");
    const ocupado = await post("recepcao", `/api/agendamentos/${alvo.body.id}/reagendar`, { inicio: em("15", "10:50"), motivo: "Pedido da família" });
    assert.equal(ocupado.status, 409);
    const historico = await get("gestor", `/api/agendamentos/${alvo.body.id}/historico`);
    const reagendado = historico.body.data.find((item) => item.acao === "reagendado");
    assert.equal(reagendado.motivo, "Atraso do transporte");
    assert.equal(new Date(reagendado.anterior.inicio).toISOString(), "2030-03-15T13:00:00.000Z");
    assert.equal(reagendado.autor.id, "s09");
  });

  it("cancelado libera o horário e não volta a ser alterado", async () => {
    const alvo = await agendar("recepcao", { inicio: em("16", "10:00") });
    assert.equal((await post("recepcao", `/api/agendamentos/${alvo.body.id}/cancelar`, {})).status, 422);
    const cancelado = await post("recepcao", `/api/agendamentos/${alvo.body.id}/cancelar`, { motivo: "Idoso hospitalizado" });
    assert.equal(cancelado.status, 200);
    assert.equal(cancelado.body.status, "cancelado");
    assert.equal((await agendar("recepcao", { inicio: em("16", "10:00") })).status, 201);
    assert.equal((await post("recepcao", `/api/agendamentos/${alvo.body.id}/reagendar`, { inicio: em("16", "15:00"), motivo: "Retorno" })).status, 409);
    await assert.rejects(prisma.$executeRaw`DELETE FROM grupo3.agendamento WHERE id = ${alvo.body.id}::uuid`);
  });

  it("realização só depois do início e uma única vez", async () => {
    const futuro = await agendar("recepcao", { inicio: em("17", "10:00") });
    assert.equal((await post("recepcao", `/api/agendamentos/${futuro.body.id}/realizacao`, { status: "realizado" })).status, 422);
    const passado = await agendar("recepcao", { inicio: "2025-01-10T10:00:00-03:00" });
    const feito = await post("fisio", `/api/agendamentos/${passado.body.id}/realizacao`, { status: "nao_realizado", observacao: "Idoso recusou" });
    assert.equal(feito.status, 200);
    assert.equal(feito.body.status, "nao_realizado");
    assert.equal(feito.body.responsavelRealizacao.nome, "Renata Gouveia");
    assert.ok(feito.body.concluidoEm);
    assert.equal((await post("recepcao", `/api/agendamentos/${passado.body.id}/realizacao`, { status: "realizado" })).status, 409);
    assert.equal((await post("recepcao", `/api/agendamentos/${passado.body.id}/cancelar`, { motivo: "Engano" })).status, 409);
  });
});

describe("grupo3 · agenda e histórico do idoso (US-066, US-072)", () => {
  it("mostra a agenda do dia com status e conflito", async () => {
    const response = await get("gestor", `/api/colaboradores/${profissional}/agenda?visao=dia&data=2030-03-12`);
    assert.equal(response.status, 200);
    assert.equal(response.body.periodo.fuso, "America/Sao_Paulo");
    assert.equal(new Date(response.body.periodo.inicio).toISOString(), "2030-03-12T03:00:00.000Z");
    assert.equal(response.body.resumo.agendado, 2);
    assert.equal(response.body.resumo.emConflito, 0);
    const semana = await get("gestor", `/api/colaboradores/${profissional}/agenda?visao=semana&data=2030-03-13`);
    assert.ok(semana.body.data.length >= 6);
  });

  it("profissional vê a própria agenda; usuário sem vínculo recebe 404", async () => {
    const fisio = await get("fisio", "/api/me/agenda?visao=mes");
    assert.equal(fisio.status, 200);
    assert.equal(fisio.body.colaborador.nome, "Renata Gouveia");
    assert.equal((await get("recepcao", "/api/me/agenda")).status, 404);
  });

  it("histórico do idoso traz realizados e futuros, do mais recente ao mais antigo", async () => {
    const response = await get("gestor", "/api/idosos/p02/atendimentos");
    assert.equal(response.status, 200);
    const status = response.body.data.map((item) => item.status);
    assert.ok(status.includes("realizado"));
    assert.ok(status.includes("agendado"));
    const datas = response.body.data.map((item) => new Date(item.inicio).getTime());
    assert.deepEqual(datas, [...datas].sort((a, b) => b - a));
    const realizados = await get("gestor", "/api/idosos/p02/atendimentos?status=realizado");
    assert.ok(realizados.body.data.every((item) => item.status === "realizado"));
    assert.equal((await get("gestor", "/api/idosos/nao-existe/atendimentos")).status, 404);
  });
});

describe("grupo3 · permissões e LGPD (NFR-014)", () => {
  it("voluntária não vê a agenda geral, só a própria", async () => {
    assert.equal((await get("voluntaria", "/api/agendamentos")).status, 403);
    assert.equal((await get("voluntaria", "/api/idosos/p02/atendimentos")).status, 403);
    assert.equal((await get("voluntaria", `/api/colaboradores/${profissional}/agenda`)).status, 403);
    const propria = await get("voluntaria", "/api/me/agenda?visao=mes");
    assert.equal(propria.status, 200);
    assert.ok(propria.body.data.every((item) => item.profissional.nome === "Helena Duarte"));
  });

  it("técnico consulta mas não agenda; sem token é 401", async () => {
    assert.equal((await get("tecnico", "/api/agendamentos")).status, 200);
    assert.equal((await agendar("tecnico", { inicio: em("18", "10:00") })).status, 403);
    assert.equal((await request(app).get("/api/agendamentos")).status, 401);
  });

  it("recepção não lê o texto de consulta; médico lê", async () => {
    const recepcao = await get("recepcao", "/api/agendamentos?categoria=consulta_medica");
    assert.equal(recepcao.status, 200);
    assert.ok(recepcao.body.data.length > 0);
    assert.ok(recepcao.body.data.every((item) => item.observacoes === null && item.conteudoRestrito === true));
    const medico = await get("medico", "/api/agendamentos?categoria=consulta_medica");
    assert.ok(medico.body.data.some((item) => item.observacoes === "Revisão de pressão arterial."));
  });

  it("só a gestão cadastra colaborador", async () => {
    assert.equal((await post("recepcao", "/api/colaboradores", { nome: "Fulano", vinculo: "voluntario" })).status, 403);
    const duplicado = await post("gestor", "/api/colaboradores", { nome: "Outra Renata", vinculo: "funcionario", usuarioId: "s06" });
    assert.equal(duplicado.status, 409);
  });
});
