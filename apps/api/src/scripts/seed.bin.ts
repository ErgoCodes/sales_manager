import { loadLocalEnv } from './provisioning';
import { runSeed } from './seed';

loadLocalEnv();
runSeed(process.env, (line) => console.log(line)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
