import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
	if ((specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL && !path.extname(specifier)) {
		const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
		for (const candidate of [base + '.ts', base + '.js', path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
			if (existsSync(candidate) && statSync(candidate).isFile()) return nextResolve(pathToFileURL(candidate).href, context);
		}
	}
	return nextResolve(specifier, context);
}
