import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calcularEnvios,
  calcularFim,
  janelaValida,
  emConflito,
  exigeMotivo,
  filtrarConflitos,
  mascarar,
  mascararHistorico,
  motivoValido,
  podeAlterar,
  podeRegistrarRealizacao,
  podeTransitar,
  sobrepoe,
  statusAposFalha,
  statusInicialLembrete,
} from "../src/grupo3/regras.js";

const P = "prof-1";
const INDIVIDUAL = "tipo-individual";
const GRUPO = "tipo-grupo";

function ag(inicio, minutos, extra = {}) {
  const i = new Date(`2030-03-12T${inicio}:00Z`);
  return { profissionalId: P, tipoId: INDIVIDUAL, permiteSobreposicao: false, inicio: i, fim: calcularFim(i, minutos), ...extra };
}

describe("grupo3 · sobreposição de horário", () => {
  it("encostar no fim do outro não sobrepõe (intervalo semiaberto)", () => {
    assert.equal(sobrepoe(ag("10:00", 30), ag("10:30", 30)), false);
    assert.equal(sobrepoe(ag("10:30", 30), ag("10:00", 30)), false);
  });

  it("um minuto dentro do outro sobrepõe", () => {
    assert.equal(sobrepoe(ag("10:00", 30), ag("10:29", 30)), true);
    assert.equal(sobrepoe(ag("10:00", 60), ag("10:15", 10)), true);
  });
});

describe("grupo3 · regra de conflito (US-073)", () => {
  it("mesmo profissional e horário sobreposto é conflito", () => {
    assert.equal(emConflito(ag("10:00", 30), ag("10:15", 30, { id: "a" })), true);
  });

  it("outro profissional não conflita", () => {
    assert.equal(emConflito(ag("10:00", 30), ag("10:00", 30, { id: "a", profissionalId: "prof-2" })), false);
  });

  it("cancelado, realizado e não realizado não conflitam", () => {
    for (const status of ["cancelado", "realizado", "nao_realizado"]) {
      assert.equal(emConflito(ag("10:00", 30), ag("10:00", 30, { id: "a", status })), false, status);
    }
  });

  it("mesmo tipo com permite_sobreposicao é exceção", () => {
    const novo = ag("10:00", 60, { tipoId: GRUPO, permiteSobreposicao: true });
    assert.equal(emConflito(novo, ag("10:00", 60, { id: "a", tipoId: GRUPO })), false);
  });

  it("tipos diferentes conflitam mesmo se um deles permitir sobreposição", () => {
    const grupo = ag("10:00", 60, { tipoId: GRUPO, permiteSobreposicao: true });
    const individual = ag("10:00", 30);
    assert.equal(emConflito(grupo, { ...individual, id: "a" }), true);
    assert.equal(emConflito(individual, { ...grupo, id: "b" }), true);
  });

  it("mesmo tipo sem permite_sobreposicao conflita", () => {
    assert.equal(emConflito(ag("10:00", 30), ag("10:00", 30, { id: "a" })), true);
  });

  it("no reagendamento o próprio agendamento é ignorado", () => {
    const existentes = [ag("10:00", 30, { id: "self" }), ag("11:00", 30, { id: "outro" })];
    assert.deepEqual(filtrarConflitos(ag("10:10", 30, { id: "self" }), existentes), []);
    assert.equal(filtrarConflitos(ag("10:50", 30, { id: "self" }), existentes).length, 1);
  });
});

describe("grupo3 · status e motivo (US-068, US-069)", () => {
  it("só sai de agendado para realizado, não realizado ou cancelado", () => {
    assert.equal(podeTransitar("agendado", "realizado"), true);
    assert.equal(podeTransitar("agendado", "nao_realizado"), true);
    assert.equal(podeTransitar("agendado", "cancelado"), true);
    assert.equal(podeTransitar("realizado", "cancelado"), false);
    assert.equal(podeTransitar("cancelado", "agendado"), false);
    assert.equal(podeAlterar("agendado"), true);
    assert.equal(podeAlterar("nao_realizado"), false);
  });

  it("realização respeita a tolerância antes do início", () => {
    const inicio = new Date("2030-03-12T10:00:00Z");
    assert.equal(podeRegistrarRealizacao(inicio, 60, new Date("2030-03-12T09:00:00Z")), true);
    assert.equal(podeRegistrarRealizacao(inicio, 60, new Date("2030-03-12T08:59:59Z")), false);
    assert.equal(podeRegistrarRealizacao(inicio, 0, new Date("2030-03-12T09:59:00Z")), false);
    assert.equal(podeRegistrarRealizacao(inicio, 0, inicio), true);
  });

  it("motivo obrigatório segue a configuração do tipo", () => {
    const tipo = { exigeMotivoCancelamento: true, exigeMotivoReagendamento: false };
    assert.equal(exigeMotivo(tipo, "cancelar"), true);
    assert.equal(exigeMotivo(tipo, "reagendar"), false);
    assert.equal(motivoValido("  "), false);
    assert.equal(motivoValido("ok"), false);
    assert.equal(motivoValido("Idoso internado"), true);
  });
});

describe("grupo3 · LGPD na agenda", () => {
  const consulta = {
    id: "a", tipo: { categoria: "consulta_medica" }, profissional: { id: "c1" },
    observacoes: "Revisão de pressão", motivoStatus: null, observacaoRealizacao: "PA 13x8",
  };

  it("esconde texto clínico de quem não tem permissão clínica", () => {
    const visto = mascarar(consulta, { permissions: ["agenda.visualizar"] });
    assert.equal(visto.observacoes, null);
    assert.equal(visto.observacaoRealizacao, null);
    assert.equal(visto.conteudoRestrito, true);
  });

  it("mostra para quem tem a permissão clínica e para o próprio profissional", () => {
    assert.equal(mascarar(consulta, { permissions: ["atendimento-clinico.visualizar"] }).observacoes, "Revisão de pressão");
    assert.equal(mascarar(consulta, { permissions: [] }, "c1").observacoes, "Revisão de pressão");
  });

  it("cuidado pessoal não é dado clínico", () => {
    const corte = { ...consulta, tipo: { categoria: "cuidado_pessoal" } };
    assert.equal(mascarar(corte, { permissions: [] }).observacoes, "Revisão de pressão");
  });

  it("histórico clínico perde motivo e texto livre sem permissão", () => {
    const item = { acao: "realizado", novo: { status: "realizado", observacaoRealizacao: "PA 13x8" }, motivo: "x" };
    const visto = mascararHistorico(item, "fisioterapia", { permissions: ["agenda.visualizar"] });
    assert.equal(visto.novo.observacaoRealizacao, undefined);
    assert.equal(visto.novo.status, "realizado");
    assert.equal(visto.motivo, null);
  });
});

describe("grupo3 · lembretes (US-074)", () => {
  const inicio = new Date("2030-03-12T13:00:00Z");

  it("agenda cada antecedência antes do início", () => {
    const envios = calcularEnvios(inicio, [60, 1440], new Date("2030-03-10T12:00:00Z"));
    assert.deepEqual(envios.map((e) => [e.antecedenciaMin, e.enviarEm.toISOString()]), [
      [1440, "2030-03-11T13:00:00.000Z"],
      [60, "2030-03-12T12:00:00.000Z"],
    ]);
  });

  it("antecedências vencidas viram um único envio imediato", () => {
    const agora = new Date("2030-03-12T12:30:00Z");
    const envios = calcularEnvios(inicio, [1440, 60, 120], agora);
    assert.equal(envios.length, 1);
    assert.equal(envios[0].antecedenciaMin, 60);
    assert.equal(envios[0].enviarEm.toISOString(), agora.toISOString());
  });

  it("atendimento já iniciado ou sem antecedência não gera lembrete", () => {
    assert.deepEqual(calcularEnvios(inicio, [1440], inicio), []);
    assert.deepEqual(calcularEnvios(inicio, [], new Date("2030-03-01T00:00:00Z")), []);
  });

  it("sem usuário vinculado o lembrete nasce sem destinatário", () => {
    assert.equal(statusInicialLembrete(null), "sem_destinatario");
    assert.equal(statusInicialLembrete("a2f1c7e0-0000-4000-8000-000000000000"), "pendente");
  });

  it("falha volta para a fila até esgotar as tentativas", () => {
    assert.equal(statusAposFalha(1, 3), "pendente");
    assert.equal(statusAposFalha(3, 3), "falha");
  });
});

describe("grupo3 · janela de atendimento (US-070)", () => {
  it("fim da janela precisa ser depois do início", () => {
    assert.equal(janelaValida("08:00", "10:00"), true);
    assert.equal(janelaValida("10:00", "10:00"), false);
    assert.equal(janelaValida("10:00", undefined), true);
  });
});
