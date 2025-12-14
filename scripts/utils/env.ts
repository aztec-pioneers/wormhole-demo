import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_ENV_PATH = join(__dirname, "../../.env");
export const ROOT_DIR = join(__dirname, "../..");

/** Get directory path from import.meta.url (ESM __dirname equivalent) */
export function getScriptDir(importMetaUrl: string): string {
    return dirname(fileURLToPath(importMetaUrl));
}

/** Get required environment variable or throw */
export function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} not set in .env`);
    return value;
}

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
        // Also update process.env so changes take effect immediately
        process.env[key] = value;
    }

    writeFileSync(rootEnvPath, envContent.trim() + "\n");
    console.log("Updated root .env");
}