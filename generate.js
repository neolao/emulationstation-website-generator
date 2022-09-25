import { argv } from 'node:process';
import { resolve as resolvePath } from 'node:path';
import { opendir, access, constants, copyFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import Twig from 'twig';

const relativeTargetPath = argv[2];
const absoluteTargetPath = resolvePath(relativeTargetPath);

const systemList = [];
const targetDirectory = await opendir(absoluteTargetPath);
for await (const directoryEntry of targetDirectory) {
    const directoryEntryPath = resolvePath(absoluteTargetPath, directoryEntry.name);
    if (directoryEntry.isDirectory() && await isSystemDirectory(directoryEntryPath)) {
        systemList.push(directoryEntry.name);
        await processSystemDirectory(directoryEntryPath, directoryEntry.name);
    }
}

await copyAssets(absoluteTargetPath);
await buildHomepage(absoluteTargetPath, systemList);


async function isSystemDirectory(path) {
    const gamelistPath = resolvePath(path, 'gamelist.xml');
    try {
        await access(gamelistPath, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

async function processSystemDirectory(path, name) {
    console.log('process', path);
    await buildSystemPage(path, name);
}

async function copyAssets(absoluteTargetPath) {
    await copyFile('./templates/style.css', resolvePath(absoluteTargetPath, 'style.css'));
}

async function buildHomepage(absoluteTargetPath, systemList) {
    return new Promise((resolve) => {
        Twig.renderFile('./templates/index.twig', {systemList}, async (err, html) => {
            const filePath = resolvePath(absoluteTargetPath, 'index.html');
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}

async function buildSystemPage(path, name) {
    const parameters = {
        title: name
    };

    return new Promise((resolve) => {
        Twig.renderFile('./templates/system/index.twig', parameters, async (err, html) => {
            const filePath = resolvePath(path, 'index.html');
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}
