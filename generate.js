import { argv } from 'node:process';
import { resolve as resolvePath, basename } from 'node:path';
import { opendir, access, constants, readFile, copyFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import Twig from 'twig';
import { XMLParser } from 'fast-xml-parser';
import sanitizeFileName from 'sanitize-filename';

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

    const gamelistPath = resolvePath(path, 'gamelist.xml');
    const gamelistXml = await readFile(gamelistPath);

    const parser = new XMLParser();
    const gamelist = parser.parse(gamelistXml);
    const games = Array.isArray(gamelist.gameList.game) ? gamelist.gameList.game : [gamelist.gameList.game];

    for (const game of games) {
        if (!game.name) {
            game.name = basename(resolvePath(path, game.path));
        }
        try {
            game.sanitizedName = sanitizeFileName(`${game.name}`, { replacement: '-' });
        } catch (error) {
            console.error(`Unable to sanitize game name: "${game.name}"`);
            throw error;
        }
        await buildGamePage(path, game);
    }

    await buildSystemPage(path, name, games);
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

async function buildSystemPage(path, name, games) {
    const parameters = {
        title: name,
        games
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

async function buildGamePage(path, data) {
    const sanitizedName = data.sanitizedName;

    console.log(data.desc);
    return new Promise((resolve) => {
        Twig.renderFile('./templates/system/game.twig', data, async (err, html) => {
            const filePath = resolvePath(path, `${sanitizedName}.html`);
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}
