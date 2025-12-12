import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_ENV_PATH = join(__dirname, "../../.env");

export function loadRootEnv() {
    config({ path: ROOT_ENV_PATH });
}

export function updateRootEnv(updates: Record<string, string>) {
    const rootEnvPath = join(__dirname, "../../.env");
    let envContent = "";

    if (existsSync(rootEnvPath)) {
        envContent = readFileSync(rootEnvPath, "utf-8");
    }

    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(envContent)) {
            envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
            envContent += `\n${key}=${value}`;
        }
    }

    writeFileSync(rootEnvPath, envContent.trim() + "\n");
    console.log("Updated root .env");
}