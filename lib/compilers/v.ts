// Copyright (c) 2023, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import path from 'path';

import {unwrap} from '../assert.js';
import {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {BaseCompiler} from '../base-compiler.js';
import {PreliminaryCompilerInfo} from '../../types/compiler.interfaces.js';

const V_DEFAULT_BACKEND = 'c';

export class VCompiler extends BaseCompiler {
    outputFileExt = `.${V_DEFAULT_BACKEND}`;

    static get key() {
        return 'v';
    }

    constructor(info: PreliminaryCompilerInfo, env) {
        super(info, env);
        this.compiler.supportsBinary = false;
        this.compiler.supportsExecute = false;
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string, userOptions?: string[]) {
        const options = unwrap(userOptions);
        if (options) {
            if (options.includes('-h') || options.includes('--help')) {
                return [];
            }

            const backend = this.getBackendFromOptions(options);
            const outputFileExt = this.getFileExtForBackend(backend);
            if (outputFileExt !== undefined) {
                this.outputFileExt = outputFileExt;
            }
        }

        const compilerOptions = ['-g'];
        if (!filters.binary) {
            compilerOptions.push('-o');
            compilerOptions.push(this.filename(this.patchOutputFilename(outputFilename)));
        }

        if (!filters.labels) {
            compilerOptions.push('-skip-unused');
        }

        return compilerOptions;
    }

    override async processAsm(result: any, filters, options: string[]): Promise<any> {
        const backend = this.getBackendFromOptions(options);
        switch (backend) {
            case 'c':
            case 'js':
            case 'js_node':
            case 'js_browser':
            case 'js_freestanding':
            case 'go':
                return this.processCLike(result, filters);
            default:
                return this.asm.process(result.asm, filters);
        }
    }

    override getSharedLibraryPathsAsArguments(libraries, libDownloadPath) {
        return [];
    }

    override getSharedLibraryLinks(libraries: any[]): string[] {
        return [];
    }

    override getOutputFilename(dirPath: string, outputFilebase: string, key?: any): string {
        return path.join(dirPath, 'output' + this.outputFileExt);
    }

    getBackendFromOptions(options: string[]): string {
        const backendOpt = options.indexOf('-b');
        if (backendOpt >= 0 && options[backendOpt + 1]) return options[backendOpt + 1].toLowerCase();
        if (options.includes('-native')) return 'native';
        if (options.includes('-interpret')) return 'interpret';

        return V_DEFAULT_BACKEND; // default V backend
    }

    getFileExtForBackend(backend: string): string | undefined {
        switch (backend) {
            case 'c':
            case 'go':
            case 'wasm':
                return '.' + backend;
            case 'js':
            case 'js_node':
            case 'js_browser':
            case 'js_freestanding':
                return '.js';
            case 'native':
                return '';
            default:
                return undefined;
        }
    }

    patchOutputFilename(outputFilename: string): string {
        const parts = outputFilename.split('.');

        if (this.outputFileExt === '') {
            parts.pop();
            return parts.join('.');
        }

        parts[parts.length - 1] = this.outputFileExt.split('.')[1];
        return parts.join('.');
    }

    removeUnusedLabels(input: string[]): string[] {
        const output: string[] = [];

        const lineRe = /^.*main__.*$/;
        const mainFunctionCall = '\tmain__main();';

        let scopeDepth = 0;
        let insertNewLine = false;

        for (const lineNo in input) {
            const line = input[lineNo];
            if (!line) continue;

            if (insertNewLine) {
                output.push('');
                insertNewLine = false;
            }

            if ((scopeDepth === 0 && line.match(lineRe) && line !== mainFunctionCall) || scopeDepth > 0) {
                const opening = (line.match(/{/g) || []).length - 1;
                const closing = (line.match(/}/g) || []).length - 1;
                scopeDepth += opening - closing;

                output.push(line);

                insertNewLine = scopeDepth === 0;
            }
        }

        return output;
    }

    removeWhitespaceLines(input: string[]): string[] {
        const output: string[] = [];

        for (const lineNo in input) {
            const line = input[lineNo];
            if (!line) continue;
            output.push(line.trimStart());
        }

        return output;
    }

    removeComments(input: string[]): string[] {
        const output: string[] = [];

        for (const lineNo in input) {
            const line = input[lineNo];
            if (line.trimStart().startsWith('//')) continue;

            output.push(line.split('//')[0]);
        }

        return output;
    }

    removeDirectives(input: string[]): string[] {
        const output: string[] = [];

        for (const lineNo in input) {
            const line = input[lineNo];
            if (!line.trimStart().startsWith('#')) output.push(line);
        }

        return output;
    }

    async processCLike(result, filters): Promise<any> {
        let lines = result.asm.split('\n');

        if (!filters.labels) lines = this.removeUnusedLabels(lines);
        if (!filters.commentOnly) lines = this.removeComments(lines);
        if (filters.trim) lines = this.removeWhitespaceLines(lines);
        if (!filters.directives) lines = this.removeDirectives(lines);

        return {asm: lines.map(line => ({text: line}))};
    }
}
