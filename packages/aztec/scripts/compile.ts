#!/usr/bin/env node
import { dirname, join } from "path";
import { mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { execCommand, copyFileWithLog, replaceInFile } from "./utils/cmd.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
    try {
        const scriptDir = __dirname;
        const packageDir = join(scriptDir, "..");
        console.log(`Working in package directory: ${packageDir}...`);
        process.chdir(packageDir);

        // Remove old artifacts
        console.log("Cleaning old artifacts...");
        await execCommand("rm", ["-rf", "target"]);

        // Compile MessageBridge contract
        console.log("Compiling MessageBridge & Wormhole contracts...");
        await execCommand("aztec-nargo", ["compile"]);

        console.log("Post-processing contract artifacts...");
        await execCommand("aztec-postprocess-contract", [], packageDir);

        // Generate TypeScript bindings
        console.log("Generating TypeScript bindings...");
        // Prepend ~/.aztec/bin to PATH to use global aztec CLI instead of node_modules version
        const aztecBinPath = process.env.HOME + "/.aztec/bin";
        const newPath = aztecBinPath + ":" + process.env.PATH;
        await execCommand("aztec", ["codegen", "target", "--outdir", "target", "-f"], packageDir, { PATH: newPath });

        // Move artifacts
        const artifactsDir = join(packageDir, "ts", "artifacts");
        console.log("Moving artifacts...");
        await copyFileWithLog(
            "./target/MessageBridge.ts",
            join(artifactsDir, "messageBridge/MessageBridge.ts")
        );
        await copyFileWithLog(
            "./target/message_bridge-MessageBridge.json",
            join(artifactsDir, "messageBridge/MessageBridge.json")
        );

        await copyFileWithLog(
            "./target/Wormhole.ts",
            join(artifactsDir, "wormhole/Wormhole.ts")
        );
        await copyFileWithLog(
            "./target/wormhole_contracts-Wormhole.json",
            join(artifactsDir, "wormhole/Wormhole.json")
        );

        // Update import paths in generated TypeScript
        console.log("Updating import paths...");
        await replaceInFile(
            join(artifactsDir, "messageBridge/MessageBridge.ts"),
            "./message_bridge-MessageBridge.json",
            "./MessageBridge.json"
        );
        await replaceInFile(
            join(artifactsDir, "wormhole/Wormhole.ts"),
            "./wormhole_contracts-Wormhole.json",
            "./Wormhole.json"
        );

        console.log("✅ Compilation completed successfully!");
    } catch (error) {
        console.error("❌ Compilation failed:", error);
        process.exit(1);
    }
}

main();
