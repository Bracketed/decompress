import { dirname, join } from 'path';
import fs from 'node:fs';
import {
	zip as decompressUnzip,
	targz as decompressTargz,
	tarbz2 as decompressTarbz2,
	tar as decompressTar,
} from '@bracketed/decompression-types';
import makeDir from 'make-dir';
import pify from 'pify';
import stripDirs from '@bracketed/strip-dirs';

const fsP = pify(fs);

const runPlugins = async (input, opts) => {
	if (opts.plugins.length === 0) {
		return await Promise.resolve([]);
	}

	const files = await Promise.all(await opts.plugins.map(async (x) => await x(input, opts)));
	return await files.reduce(async (a, b) => await a.concat(b));
};

const safeMakeDir = async (dir, realOutputPath) => {
	return await fsP
		.realpath(await dir)
		.catch(async () => {
			const parent = dirname(dir);
			return await safeMakeDir(parent, realOutputPath);
		})
		.then(async (realParentPath) => {
			if (realParentPath.indexOf(realOutputPath) !== 0) {
				throw new Error('Refusing to create a directory outside the output path.');
			}

			return await makeDir(dir).then(fsP.realpath);
		});
};

const preventWritingThroughSymlink = async (destination, realOutputPath) => {
	return await fsP
		.readlink(destination)
		.catch(() => null)
		.then(async (symlinkPointsTo) => {
			if (symlinkPointsTo) {
				throw new Error('Refusing to write into a symlink');
			}
			return realOutputPath;
		});
};

const extractFile = async (input, output, opts) =>
	await runPlugins(input, opts).then(async (files) => {
		if (opts.strip > 0) {
			files = await files
				.map(async (x) => {
					x.path = await stripDirs(x.path, opts.strip);
					return x;
				})
				.filter((x) => x.path !== '.');
		}

		if (typeof opts.filter === 'function') {
			files = await files.filter(await opts.filter);
		}

		if (typeof opts.map === 'function') {
			files = await files.map(await opts.map);
		}

		if (!output) {
			return files;
		}

		return await Promise.all(
			await files.map(async (x) => {
				const dest = join(output, x.path);
				const mode = x.mode & ~process.umask();
				const now = new Date();

				if (x.type === 'directory') {
					const outputPath = await makeDir(output);
					const realOutputPath = await fsP.realpath(outputPath);
					await safeMakeDir(dest, realOutputPath);
					await fsP.utimes(dest, now, x.mtime);
					return x;
				}

				return await makeDir(output)
					.then(async (outputPath) => await fsP.realpath(outputPath))
					.then(async (realOutputPath) => {
						// Attempt to ensure parent directory exists (failing if it's outside the output dir)
						return await safeMakeDir(dirname(dest), realOutputPath).then(async () => realOutputPath);
					})
					.then(async (realOutputPath) => {
						if (x.type === 'file') {
							return await preventWritingThroughSymlink(dest, realOutputPath);
						}

						return await realOutputPath;
					})
					.then(async (realOutputPath) => {
						return await fsP.realpath(dirname(dest)).then(async (realDestinationDir) => {
							if (realDestinationDir.indexOf(realOutputPath) !== 0) {
								throw new Error('Refusing to write outside output directory: ' + realDestinationDir);
							}
						});
					})
					.then(async () => {
						if (x.type === 'link') {
							return await fsP.link(x.linkname, dest);
						}

						if (x.type === 'symlink' && process.platform === 'win32') {
							return await fsP.link(x.linkname, dest);
						}

						if (x.type === 'symlink') {
							return await fsP.symlink(x.linkname, dest);
						}

						return await fsP.writeFile(dest, x.data, { mode });
					})
					.then(async () => x.type === 'file' && (await fsP.utimes(dest, now, x.mtime)))
					.then(() => x);
			})
		);
	});

export default async (input, output, opts) => {
	if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
		return await Promise.reject(new TypeError('Input file required'));
	}

	if (typeof output === 'object') {
		opts = output;
		output = null;
	}

	opts = await Object.assign(
		{ plugins: [decompressTar(), decompressTarbz2(), decompressTargz(), decompressUnzip()] },
		opts
	);

	const read = typeof input === 'string' ? await fsP.readFile(input) : await Promise.resolve(input);

	return await read.then(async (buf) => await extractFile(buf, output, opts));
};

