import { argv } from 'node:process';
import { resolve as resolvePath, basename } from 'node:path';
import { opendir, access, constants, readFile, writeFile } from 'node:fs/promises';
import { copy } from 'fs-extra';
import { Buffer } from 'node:buffer';
import Twig from 'twig';
import { XMLParser } from 'fast-xml-parser';
import sanitizeFileName from 'sanitize-filename';
import Jimp from 'jimp';
import supportedSystems from './systems.json' assert { type: "json" };

const relativeTargetPath = argv[2];
const absoluteTargetPath = resolvePath(relativeTargetPath);

await copyAssets(absoluteTargetPath);

const systems = [];
const targetDirectory = await opendir(absoluteTargetPath);
for await (const directoryEntry of targetDirectory) {
    const directoryEntryPath = resolvePath(absoluteTargetPath, directoryEntry.name);

    const systemId = directoryEntry.name;
    if (!supportedSystems[systemId]) {
        continue;
    }
    const systemName = supportedSystems[systemId];

    if (directoryEntry.isDirectory() && await isSystemDirectory(directoryEntryPath)) {
        const system = {
            id: systemId,
            name: systemName,
            logo: `/assets/${systemId}.svg`
        };
        systems.push(system);
        await processSystemDirectory(directoryEntryPath, system);
    }
}

systems.sort((a, b) => {
    if (a.name < b.name) {
        return -1;
    }

    if (a.name > b.name) {
        return 1;
    }

    return 0;
});
await buildHomepage(absoluteTargetPath, systems);


async function isSystemDirectory(path) {
    const gamelistPath = resolvePath(path, 'gamelist.xml');
    try {
        await access(gamelistPath, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

async function processSystemDirectory(path, system) {
    console.log('process', path);

    const gamelistPath = resolvePath(path, 'gamelist.xml');
    const gamelistXml = await readFile(gamelistPath);

    const parser = new XMLParser();
    const gamelist = parser.parse(gamelistXml);
    let games = Array.isArray(gamelist.gameList.game) ? gamelist.gameList.game : [gamelist.gameList.game];

    for (const game of games) {
        if (!game.name) {
            game.name = basename(resolvePath(path, game.path));
        }
        game.sanitizedName = buildSanitizedGameName(game);
        game.generatedThumbnail = await tryToGenerateThumbnail(path, game);
        await buildGamePage(path, game);
    }

    games = games.filter((game) => {
        if (game.hidden && game.hidden === 'true') {
            return false;
        }
        return true;
    });
    games.sort((a, b) => {
        if (a.name < b.name) {
            return -1;
        }
        if (a.name > b.name) {
            return 1;
        }
        return 0;
    });
    await buildSystemPage(path, system, games);
}

function buildSanitizedGameName(game) {
    let sanitizedName = game.name;
    try {
        sanitizedName = sanitizeFileName(`${game.name}`, { replacement: '-' });
    } catch (error) {
        console.error(`Unable to sanitize game name: "${game.name}"`);
        throw error;
    }

    sanitizedName = sanitizedName.replaceAll('#', '-');

    return sanitizedName;
}

async function copyAssets(absoluteTargetPath) {
    await copy('./templates/style.css', resolvePath(absoluteTargetPath, 'style.css'));
    await copy('./templates/assets', resolvePath(absoluteTargetPath, 'assets'));
}

async function buildHomepage(absoluteTargetPath, systems) {
    return new Promise((resolve) => {
        Twig.renderFile('./templates/index.twig', {systems}, async (err, html) => {
            const filePath = resolvePath(absoluteTargetPath, 'index.html');
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}

async function buildSystemPage(path, system, games) {
    const parameters = {
        title: system.name,
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

    return new Promise((resolve) => {
        Twig.renderFile('./templates/system/game.twig', data, async (err, html) => {
            const filePath = resolvePath(path, `${sanitizedName}.html`);
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}

async function tryToGenerateThumbnail(systemPath, game) {
    if (!game.thumbnail) {
        return 'https://via.placeholder.com/100';
    }

    const originalImagePath = resolvePath(systemPath, game.thumbnail);
    try {
        await access(originalImagePath, constants.R_OK);
    } catch {
        return 'https://via.placeholder.com/100';
    }

    const relativeGeneratedImagePath = `${game.sanitizedName}-100.png`;
    const generatedImagePath = resolvePath(systemPath, relativeGeneratedImagePath);
    try {
        await access(generatedImagePath, constants.R_OK);
        return relativeGeneratedImagePath;
    } catch {
    }


    const image = await Jimp.read(originalImagePath);
    await image.resize(Jimp.AUTO, 100);
    await image.writeAsync(generatedImagePath);

    return relativeGeneratedImagePath;
}
