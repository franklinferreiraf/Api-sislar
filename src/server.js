import { app } from "./app.js";
import { config } from "./config.js";
import { iniciarJobs } from "./grupo3/jobs.js";

app.listen(config.port, () => {
  console.log(`SISLAR API em http://localhost:${config.port}`);
});

if (process.env.JOBS_ENABLED === "true") {
  iniciarJobs();
  console.log("Jobs agendados ligados.");
}
