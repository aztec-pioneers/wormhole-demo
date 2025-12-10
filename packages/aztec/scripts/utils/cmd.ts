import { spawn } from "child_process";
import { copyFile, readFile, writeFile } from "fs/promises";

export async function execCommand(
  command: string,
  args: string[] = [],
  cwd?: string,
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...env }
    });

    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit code: ${exitCode})`));
      } else {
        resolve();
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to execute command: ${error.message}`));
    });
  });
}

export async function copyFileWithLog(src: string, dest: string): Promise<void> {
  try {
    await copyFile(src, dest);
    console.log(`Copied: ${src} → ${dest}`);
  } catch (error) {
    throw new Error(`Failed to copy ${src} to ${dest}: ${error}`);
  }
}

export async function replaceInFile(filePath: string, searchText: string, replaceText: string): Promise<void> {
  try {
    const content = await readFile(filePath, "utf-8");
    const updatedContent = content.replace(
      new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      replaceText
    );
    await writeFile(filePath, updatedContent, "utf-8");
    console.log(`Updated imports in: ${filePath}`);
  } catch (error) {
    throw new Error(`Failed to update file ${filePath}: ${error}`);
  }
}
