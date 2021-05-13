/*
Copyright 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { spawn } from 'child_process';
import { mkdtemp } from 'fs/promises';
import path from 'path';
import os from 'os';

let tempFolder: string;

const ensureTempFolder = async() => {
    if (!tempFolder) {
        tempFolder = await mkdtemp(path.join(os.tmpdir(), 'slack-bridge-convert'));
    }
    return tempFolder;
};

// eslint-disable-next-line @typescript-eslint/promise-function-async
const spawnConvertProcess = (inputPath: string, outputPath: string) =>
    new Promise<void>((resolve, reject) => {
        const ls = spawn(
            'convert',
            [inputPath, outputPath],
        );
        ls.on('close', (code) => {
            if (code !== 0) {
                reject(`convert exited with code ${code}`);
            }
            resolve();
        });
        ls.on('error', () => {
            reject('Failed to start convert. Is it installed and in the PATH?');
        });
    });

/**
 * Converts an image from one file format to another.
 * @param inputPath The path of the image file
 * @param targetMimetypes A list of target mimetypes
 */
const convertImage = async (inputPath: string, targetMimetypes = ['image/jpeg']): Promise<string|undefined> => {
    let outputFilename;
    for (const mimetype of targetMimetypes) {
        if (/^image\/jpe?g$/.test(mimetype)) {
            outputFilename = path.basename(inputPath) + '.jpg';
            break;
        } else if (mimetype === 'image/png') {
            outputFilename = path.basename(inputPath) + '.png';
            break;
        }
    }
    if (outputFilename) {
        const folder = await ensureTempFolder();
        const outputPath = path.join(folder, outputFilename);
        await spawnConvertProcess(inputPath, outputPath);
        return outputPath;
    }
};

export default convertImage;
