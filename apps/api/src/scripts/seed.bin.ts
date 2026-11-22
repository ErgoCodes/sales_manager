import { loadLocalEnv } from './provisioning';
import { runSeed, SEED_USAGE } from './seed';

loadLocalEnv();
// pnpm forwards a literal `--` before the script's own arguments.
const argv = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
runSeed(process.env, (line) => console.log(line), argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(SEED_USAGE);
  process.exitCode = 1;
});
