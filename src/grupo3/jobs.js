// Jobs agendados do Grupo 3 (T-008). O repositório não tinha mecanismo de jobs: o agendador roda no
// próprio processo e só liga com JOBS_ENABLED=true (desligado nos testes). Com várias instâncias, cada job
// usa FOR UPDATE SKIP LOCKED para não processar o mesmo item duas vezes.
import { processarLembretes } from "./lembretes.js";

const JOBS = [{ nome: "lembretes", executar: () => processarLembretes() }];

export function iniciarJobs({ intervaloSeg = Number(process.env.JOBS_INTERVALO_SEG || 60) } = {}) {
  const emExecucao = new Set();
  const rodar = async () => {
    for (const job of JOBS) {
      if (emExecucao.has(job.nome)) continue;
      emExecucao.add(job.nome);
      try {
        const resumo = await job.executar();
        if (resumo?.processados) console.log(`[grupo3:${job.nome}]`, JSON.stringify(resumo));
      } catch (error) {
        // Log técnico sem dados do idoso.
        console.error(`[grupo3:${job.nome}] falhou: ${error?.message || error}`);
      } finally {
        emExecucao.delete(job.nome);
      }
    }
  };
  const timer = setInterval(rodar, Math.max(intervaloSeg, 10) * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
