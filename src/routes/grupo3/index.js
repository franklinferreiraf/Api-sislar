// Rotas do Grupo 3 (Agenda, atendimentos e profissionais), montadas em /api.
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import agendamentosRouter from "./agendamentos.js";
import clinicoRouter from "./clinico.js";
import colaboradoresRouter from "./colaboradores.js";
import escalasRouter from "./escalas.js";
import especialidadesRouter from "./especialidades.js";
import fisioterapiaRouter from "./fisioterapia.js";
import presencasRouter from "./presencas.js";
import tiposAtendimentoRouter from "./tipos-atendimento.js";

const router = Router();

// Reaproveita a sessão já carregada por um router anterior em /api; senão autentica.
router.use((req, res, next) => (req.user ? next() : requireAuth(req, res, next)));
router.use(tiposAtendimentoRouter);
router.use(colaboradoresRouter);
router.use(agendamentosRouter);
router.use(especialidadesRouter);
router.use(escalasRouter);
router.use(presencasRouter);
router.use(clinicoRouter);
router.use(fisioterapiaRouter);

export default router;
