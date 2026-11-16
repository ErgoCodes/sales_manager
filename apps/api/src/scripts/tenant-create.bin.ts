import { runTenantCreate } from './tenant-create';
import { loadLocalEnv } from './provisioning';

loadLocalEnv();
runTenantCreate(process.argv.slice(2), process.env, (line) => console.log(line)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
