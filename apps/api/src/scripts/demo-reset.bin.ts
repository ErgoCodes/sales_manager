import { runDemoReset } from './demo-reset';
import { loadLocalEnv } from './provisioning';

loadLocalEnv();
runDemoReset(process.env, (line) => console.log(line)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
