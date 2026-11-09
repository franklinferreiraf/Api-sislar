import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { processarLembretes } from "../src/grupo3/lembretes.js";
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
    for (const rota of ["/api/agendas/farmacia", "/api/agendas/cuidados-pessoais", "/api/idosos/{idosoId}/cuidados-pessoais", "/api/agendamentos/{id}/lembretes"]) {
      assert.ok(spec.paths[rota]?.get, rota);
    }
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
    assert.equal(feito.body.responsavelRealizacao.id, profissional);
    assert.equal(feito.body.registradoPor.id, "s06");
    assert.ok(feito.body.concluidoEm);
    assert.equal((await post("recepcao", `/api/agendamentos/${passado.body.id}/realizacao`, { status: "realizado" })).status, 409);
    assert.equal((await post("recepcao", `/api/agendamentos/${passado.body.id}/cancelar`, { motivo: "Engano" })).status, 409);
  });
});

describe("grupo3 · tolerância e correção da realização", () => {
  const daquiA = (minutos) => new Date(Date.now() + minutos * 60_000).toISOString();

  it("aceita realização dentro da tolerância do tipo e recusa fora dela", async () => {
    const dentro = await agendar("recepcao", { inicio: daquiA(30) });
    const fora = await agendar("recepcao", { inicio: daquiA(180) });
    assert.equal((await post("recepcao", `/api/agendamentos/${dentro.body.id}/realizacao`, { status: "realizado" })).status, 200);
    const recusa = await post("recepcao", `/api/agendamentos/${fora.body.id}/realizacao`, { status: "realizado" });
    assert.equal(recusa.status, 422);
    assert.match(recusa.body.error.details[0].message, /60 min/);
    const semTolerancia = await post("admin", "/api/tipos-atendimento", {
      nome: "Teste sem tolerância", categoria: "outro", duracaoPadraoMin: 20, toleranciaRealizacaoMin: 0,
    });
    assert.equal(semTolerancia.body.toleranciaRealizacaoMin, 0);
    const cedo = await agendar("recepcao", { tipoId: semTolerancia.body.id, inicio: daquiA(300) });
    assert.equal((await post("recepcao", `/api/agendamentos/${cedo.body.id}/realizacao`, { status: "realizado" })).status, 422);
  });

  it("corrige realização só com agenda.administrar e motivo, e registra no histórico", async () => {
    const alvo = await agendar("recepcao", { inicio: "2025-02-10T10:00:00-03:00" });
    await post("recepcao", `/api/agendamentos/${alvo.body.id}/realizacao`, { status: "realizado", observacao: "Feito" });
    const url = `/api/agendamentos/${alvo.body.id}/corrigir-realizacao`;
    assert.equal((await post("recepcao", url, { status: "nao_realizado", motivo: "Registro no idoso errado" })).status, 403);
    assert.equal((await post("gestor", url, { status: "nao_realizado" })).status, 422);
    assert.equal((await post("gestor", url, { status: "realizado", motivo: "Sem mudança real" })).status, 422);
    const corrigido = await post("gestor", url, { status: "nao_realizado", observacao: "Idoso dormia", motivo: "Lançado como realizado por engano" });
    assert.equal(corrigido.status, 200);
    assert.equal(corrigido.body.status, "nao_realizado");
    assert.equal(corrigido.body.observacaoRealizacao, "Idoso dormia");
    assert.equal(corrigido.body.registradoPor.id, "s09");
    const historico = await get("gestor", `/api/agendamentos/${alvo.body.id}/historico`);
    const item = historico.body.data.find((linha) => linha.acao === "corrigido");
    assert.equal(item.anterior.status, "realizado");
    assert.equal(item.novo.status, "nao_realizado");
    assert.equal(item.motivo, "Lançado como realizado por engano");
    assert.equal(item.autor.id, "s02");
    const cancelado = await agendar("recepcao", { inicio: em("21", "10:00") });
    await post("recepcao", `/api/agendamentos/${cancelado.body.id}/cancelar`, { motivo: "Sem vaga" });
    assert.equal((await post("gestor", `/api/agendamentos/${cancelado.body.id}/corrigir-realizacao`, { status: "realizado", motivo: "Teste" })).status, 409);
  });

  it("o banco continua bloqueando alteração direta de agendamento encerrado", async () => {
    const alvo = await agendar("recepcao", { inicio: "2025-03-10T10:00:00-03:00" });
    await post("recepcao", `/api/agendamentos/${alvo.body.id}/realizacao`, { status: "realizado" });
    await assert.rejects(prisma.$executeRaw`UPDATE grupo3.agendamento SET status = 'nao_realizado' WHERE id = ${alvo.body.id}::uuid`);
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('grupo3.correcao_realizacao', 'on', true)`;
      await tx.$executeRaw`UPDATE grupo3.agendamento SET inicio = inicio + interval '1 hour' WHERE id = ${alvo.body.id}::uuid`;
    }));
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

// ---------------- Fatia 2 ----------------

async function tipoPorNome(nome) {
  const lista = await get("admin", "/api/tipos-atendimento?limit=100");
  return lista.body.data.find((tipo) => tipo.nome === nome).id;
}

async function colaboradorPorNome(nome) {
  const lista = await get("admin", `/api/colaboradores?q=${encodeURIComponent(nome)}`);
  return lista.body.data.find((item) => item.nome === nome).id;
}

const lembretes = async (perfil, id) => (await get(perfil, `/api/agendamentos/${id}/lembretes`)).body.data;

describe("grupo3 · agenda da farmácia (US-070)", () => {
  let farmaceutico;
  let farmacia;

  before(async () => {
    farmaceutico = (await post("gestor", "/api/colaboradores", { nome: "Farmacêutica de teste", vinculo: "funcionario" })).body.id;
    farmacia = await tipoPorNome("Atendimento da farmácia");
    const corte = await tipoPorNome("Corte de cabelo");
    for (const [hora, tipoId, idosoId] of [["08:30", farmacia, "p01"], ["14:00", farmacia, "p02"], ["09:00", corte, "p03"]]) {
      const criado = await post("recepcao", "/api/agendamentos", { idosoId, tipoId, profissionalId: farmaceutico, inicio: `2030-04-02T${hora}:00-03:00` });
      assert.equal(criado.status, 201);
    }
  });

  it("filtra por janela de atendimento no fuso da instituição", async () => {
    const dia = await get("tecnico", `/api/agendas/farmacia?visao=dia&data=2030-04-02&profissionalId=${farmaceutico}`);
    assert.equal(dia.status, 200);
    assert.equal(dia.body.data.length, 2);
    assert.ok(dia.body.data.every((item) => item.tipo.categoria === "farmacia"));
    assert.equal(dia.body.porProfissional[0].total, 2);
    const manha = await get("tecnico", `/api/agendas/farmacia?visao=dia&data=2030-04-02&profissionalId=${farmaceutico}&janelaInicio=08:00&janelaFim=10:00`);
    assert.equal(manha.body.data.length, 1);
    assert.deepEqual(manha.body.janela, { inicio: "08:00", fim: "10:00" });
    const lista = await get("tecnico", `/api/agendamentos?categoria=farmacia&profissionalId=${farmaceutico}&janelaInicio=13:00`);
    assert.equal(lista.body.data.length, 1);
  });

  it("filtra por responsável e recusa janela invertida", async () => {
    const outro = await get("tecnico", `/api/agendas/farmacia?visao=dia&data=2030-04-02&profissionalId=${profissional}`);
    assert.equal(outro.body.data.length, 0);
    assert.equal((await get("tecnico", "/api/agendas/farmacia?janelaInicio=10:00&janelaFim=09:00")).status, 422);
    assert.equal((await get("tecnico", "/api/agendas/farmacia?janelaInicio=25:00")).status, 422);
    assert.equal((await get("voluntaria", "/api/agendas/farmacia")).status, 403);
  });
});

describe("grupo3 · cuidados pessoais (US-071)", () => {
  it("mostra agenda própria e histórico de realização por serviço", async () => {
    const corte = await tipoPorNome("Corte de cabelo");
    const barba = await tipoPorNome("Barba");
    const cabeleireiro = await colaboradorPorNome("Jorge Matias (cabeleireiro)");
    const feito = await post("recepcao", "/api/agendamentos", { idosoId: "p04", tipoId: corte, profissionalId: cabeleireiro, inicio: "2025-05-05T10:00:00-03:00" });
    await post("recepcao", `/api/agendamentos/${feito.body.id}/realizacao`, { status: "realizado" });
    const barbaFeita = await post("recepcao", "/api/agendamentos", { idosoId: "p04", tipoId: barba, profissionalId: cabeleireiro, inicio: "2025-05-05T11:00:00-03:00" });
    await post("recepcao", `/api/agendamentos/${barbaFeita.body.id}/realizacao`, { status: "realizado" });

    const historico = await get("recepcao", "/api/idosos/p04/cuidados-pessoais");
    assert.equal(historico.status, 200);
    const porTipo = Object.fromEntries(historico.body.data.map((item) => [item.tipo.nome, item]));
    assert.equal(porTipo["Corte de cabelo"].totalRealizados, 1);
    assert.equal(porTipo["Corte de cabelo"].ultimaRealizacao.responsavel.nome, "Jorge Matias (cabeleireiro)");
    assert.ok(porTipo["Corte de cabelo"].proximoAgendamento);
    assert.equal(porTipo.Barba.proximoAgendamento, null);

    const agenda = await get("recepcao", "/api/agendas/cuidados-pessoais?visao=mes&data=2025-05-05");
    assert.equal(agenda.status, 200);
    assert.ok(agenda.body.data.length >= 2);
    assert.ok(agenda.body.data.every((item) => item.tipo.categoria === "cuidado_pessoal"));
    assert.equal((await get("recepcao", "/api/idosos/nao-existe/cuidados-pessoais")).status, 404);
  });
});

describe("grupo3 · lembretes (US-074)", () => {
  let renata;

  before(async () => {
    renata = await colaboradorPorNome("Renata Gouveia");
  });

  it("agenda lembrete 24 h antes para colaborador com usuário", async () => {
    const criado = await agendar("recepcao", { profissionalId: renata, inicio: "2030-04-05T10:00:00-03:00" });
    const lista = await lembretes("recepcao", criado.body.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].status, "pendente");
    assert.equal(lista[0].antecedenciaMin, 1440);
    assert.equal(new Date(lista[0].enviarEm).toISOString(), "2030-04-04T13:00:00.000Z");
    assert.equal(lista[0].destinatario.usuarioId, "s06");
  });

  it("colaborador sem usuário gera lembrete sem_destinatario, visível na API", async () => {
    const criado = await agendar("recepcao", { inicio: "2030-04-06T10:00:00-03:00" });
    const lista = await lembretes("recepcao", criado.body.id);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].status, "sem_destinatario");
    assert.match(lista[0].ultimoErro, /sem usuário/);
  });

  it("vincular usuário depois devolve o lembrete para a fila", async () => {
    const semUsuario = (await post("gestor", "/api/colaboradores", { nome: "Psicóloga de teste", vinculo: "externo" })).body.id;
    const criado = await agendar("recepcao", { profissionalId: semUsuario, inicio: "2030-04-07T10:00:00-03:00" });
    assert.equal((await lembretes("recepcao", criado.body.id))[0].status, "sem_destinatario");
    const vinculo = await request(app).put(`/api/colaboradores/${semUsuario}`).set(await como("gestor"))
      .send({ nome: "Psicóloga de teste", vinculo: "externo", usuarioId: "s16" });
    assert.equal(vinculo.status, 200);
    const lista = await lembretes("recepcao", criado.body.id);
    assert.equal(lista[0].status, "pendente");
    assert.equal(lista[0].destinatario.usuarioId, "s16");
  });

  it("antecedências configuradas por tipo; lista vazia desliga", async () => {
    const dois = await post("admin", "/api/tipos-atendimento", {
      nome: "Teste dois lembretes", categoria: "outro", duracaoPadraoMin: 30, antecedenciasLembreteMin: [60, 1440, 60],
    });
    assert.deepEqual(dois.body.antecedenciasLembreteMin, [1440, 60]);
    const nenhum = await post("admin", "/api/tipos-atendimento", {
      nome: "Teste sem lembrete", categoria: "outro", duracaoPadraoMin: 30, antecedenciasLembreteMin: [],
    });
    const a = await agendar("recepcao", { tipoId: dois.body.id, profissionalId: renata, inicio: "2030-04-08T10:00:00-03:00" });
    const b = await agendar("recepcao", { tipoId: nenhum.body.id, profissionalId: renata, inicio: "2030-04-08T14:00:00-03:00" });
    assert.equal((await lembretes("recepcao", a.body.id)).length, 2);
    assert.equal((await lembretes("recepcao", b.body.id)).length, 0);
    assert.equal((await post("admin", "/api/tipos-atendimento", { nome: "Teste inválido", categoria: "outro", duracaoPadraoMin: 30, antecedenciasLembreteMin: [1] })).status, 422);
  });

  it("reagendar cancela o lembrete antigo e cria outro; cancelar encerra a fila", async () => {
    const criado = await agendar("recepcao", { profissionalId: renata, inicio: "2030-04-09T10:00:00-03:00" });
    await post("recepcao", `/api/agendamentos/${criado.body.id}/reagendar`, { inicio: "2030-04-10T10:00:00-03:00", motivo: "Troca de dia" });
    const depois = await lembretes("recepcao", criado.body.id);
    assert.deepEqual(depois.map((item) => item.status).sort(), ["cancelado", "pendente"]);
    assert.equal(new Date(depois.find((item) => item.status === "pendente").enviarEm).toISOString(), "2030-04-09T13:00:00.000Z");
    await post("recepcao", `/api/agendamentos/${criado.body.id}/cancelar`, { motivo: "Família levou ao médico" });
    assert.ok((await lembretes("recepcao", criado.body.id)).every((item) => item.status === "cancelado"));
  });

  it("job entrega na caixa de notificações e não reenvia", async () => {
    const proximo = await agendar("recepcao", { profissionalId: renata, inicio: new Date(Date.now() + 45 * 60_000).toISOString(), local: "Sala 3" });
    const [pendente] = await lembretes("recepcao", proximo.body.id);
    assert.equal(pendente.status, "pendente");
    const resumo = await processarLembretes();
    assert.ok(resumo.entregues >= 1);
    const [entregue] = await lembretes("recepcao", proximo.body.id);
    assert.equal(entregue.status, "entregue");
    assert.equal(entregue.canal, "interno");
    assert.ok(entregue.entregueEm);
    const caixa = await get("fisio", "/api/notificacoes");
    const aviso = caixa.body.data.find((item) => item.kind === "agenda" && item.link === `/agenda/agendamentos/${proximo.body.id}`);
    assert.ok(aviso);
    assert.match(aviso.body, /Sala 3/);
    const segunda = await processarLembretes();
    assert.equal(segunda.processados, 0);
  });

  it("falha no envio tenta de novo e marca falha ao esgotar as tentativas", async () => {
    const proximo = await agendar("recepcao", { profissionalId: renata, inicio: new Date(Date.now() + 100 * 60_000).toISOString() });
    assert.equal(proximo.status, 201);
    const quebrado = async () => { throw new Error("canal indisponível"); };
    await processarLembretes({ enviar: quebrado });
    let [item] = await lembretes("recepcao", proximo.body.id);
    assert.equal(item.status, "pendente");
    assert.equal(item.tentativas, 1);
    await processarLembretes({ enviar: quebrado });
    await processarLembretes({ enviar: quebrado });
    [item] = await lembretes("recepcao", proximo.body.id);
    assert.equal(item.status, "falha");
    assert.equal(item.tentativas, 3);
    assert.equal(item.ultimoErro, "canal indisponível");
  });

  it("lembretes seguem a mesma permissão do agendamento", async () => {
    const criado = await agendar("recepcao", { profissionalId: renata, inicio: "2030-04-11T10:00:00-03:00" });
    assert.equal((await get("voluntaria", `/api/agendamentos/${criado.body.id}/lembretes`)).status, 403);
    assert.equal((await get("fisio", `/api/agendamentos/${criado.body.id}/lembretes`)).status, 200);
  });
});
