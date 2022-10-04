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
    games = filterLastUniqueFilePath(games);

    for (const game of games) {
        if (!game.name) {
            game.name = basename(resolvePath(path, game.path));
        }
        game.path = cleanGamePath(game.path);
        game.sanitizedFileName = buildSanitizedGameFileName(game);
        if (game.image) {
            game.image = cleanGamePath(game.image);
            game.imageUrlEncoded = urlEncode(game.image);
        }
        if (game.video) {
            game.video = cleanGamePath(game.video);
            game.videoUrlEncoded = urlEncode(game.video);
        }
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

function cleanGamePath(path) {
    let newPath = path;

    if (path.startsWith('./')) {
        newPath = path.substring(2);
    }

    return newPath;
}

function filterLastUniqueFilePath(games) {
    const uniqueGames = new Map();
    for (const game of games) {
        uniqueGames.set(game.path, game);
    }

    return Array.from(uniqueGames.values());
}

function urlEncode(path) {
    return encodeURIComponent(path);
}

function buildSanitizedGameFileName(game) {
    let sanitizedName = game.path;
    try {
        sanitizedName = sanitizeFileName(`${game.path}`, { replacement: '-' });
    } catch (error) {
        console.error(`Unable to sanitize game file path: "${game.path}"`);
        throw error;
    }

    sanitizedName = sanitizedName.replaceAll('#', '-');
    sanitizedName = sanitizedName.replaceAll('%', '-');
    sanitizedName = sanitizedName.replaceAll('!', '-');
    sanitizedName = sanitizedName.replaceAll('[', '-');
    sanitizedName = sanitizedName.replaceAll(']', '-');
    sanitizedName = sanitizedName.replaceAll('+', '-');

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
        system,
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
    const sanitizedFileName = data.sanitizedFileName;

    return new Promise((resolve) => {
        Twig.renderFile('./templates/system/game.twig', data, async (err, html) => {
            const filePath = resolvePath(path, `${sanitizedFileName}.html`);
            const data = new Uint8Array(Buffer.from(html));
            await writeFile(filePath, data);
            resolve();
        });
    });
}

async function tryToGenerateThumbnail(systemPath, game) {
    let originalImage;
    if (game.thumbnail) {
        originalImage = game.thumbnail;
    } else if (game.image) {
        originalImage = game.image;
    } else {
        console.error("Unable to generate thumbnail", game);
        return 'https://via.placeholder.com/100';
    }

    const originalImagePath = resolvePath(systemPath, originalImage);
    try {
        await access(originalImagePath, constants.R_OK);
    } catch {
        return 'https://via.placeholder.com/100';
    }

    const relativeGeneratedImagePath = `${game.sanitizedFileName}-100.png`;
    const generatedImagePath = resolvePath(systemPath, relativeGeneratedImagePath);
    try {
        await access(generatedImagePath, constants.R_OK);
        return relativeGeneratedImagePath;
    } catch {
    }


    try {
        const image = await Jimp.read(originalImagePath);
        await image.resize(Jimp.AUTO, 100);
        await image.writeAsync(generatedImagePath);
    } catch (error) {
        console.error(`Unable to generate thumbnail: ${originalImagePath}`);
        console.error(error);
        return 'https://via.placeholder.com/100';
    }


    return relativeGeneratedImagePath;
}
