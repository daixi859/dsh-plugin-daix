// Live smoke test: call the three providers once with real credentials.
// Reads only — writes nothing, installs nothing.
import { UsageSuiteService } from "./lib/index.js";

const service = new UsageSuiteService({ timeoutMs: 20000 });
for (const provider of ["ocgo", "deepseek", "zhipu"]) {
	const result = await service.view(provider, { force: true });
	if (result.ok) {
		console.log("[" + provider + "] OK  updatedAt=" + new Date(result.updatedAt).toISOString());
		console.log("  " + JSON.stringify(result.data));
	} else {
		console.log("[" + provider + "] ERR code=" + result.error.code + " message=" + result.error.message);
	}
}
console.log("\nmasked config view:");
console.log(JSON.stringify(service.configView(), null, 2));
