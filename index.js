'use strict';

var AdmZip = require('adm-zip');
var endsWith = require('mout/string/endsWith');
var find = require('mout/array/find');
var fs = require('fs');
var mkdir = require('mkdirp');
var path = require('path');
var pipeline = require('stream-combiner');
var rm = require('rimraf');
var tar = require('tar');
var tempfile = require('tempfile');
var zlib = require('zlib');

/**
 * Initialize Decompress with options
 *
 * Options:
 *
 *   - `ext` String with file name, MIME type, etc
 *   - `path` Path to extract to
 *
 * @param {Object} opts
 * @api private
 */

function Decompress(opts) {
    opts = opts || {};
    this.opts = opts;
    this.path = opts.path || process.cwd();
    this.ext = opts.ext || '';
    this.strip = +opts.strip || 0;
    this.extractors = {
        '.zip': this._extractZip,
        '.tar': this._extractTar,
        '.tar.gz': this._extractTarGz,
        '.tgz': this._extractTarGz,
        'application/zip': this._extractZip,
        'application/x-tar': this._extractTar,
        'application/x-tgz': this._extractTarGz
    };
    this.extractorTypes = Object.keys(this.extractors);
    this.extractor = this._getExtractor(this.ext);
}

/**
 * Extract an archive
 *
 * @api public
 */

Decompress.prototype.extract = function () {
    var self = this;
    var stream = this.extractor();

    if (!fs.existsSync(this.path)) {
        mkdir.sync(self.path);
    }

    return stream;
};

/**
 * Check if a file can be extracted
 *
 * @param {String} src
 * @param {String} mime
 * @api public
 */

Decompress.prototype.canExtract = function (src, mime) {
    if (this._getExtractor(src)) {
        return true;
    }

    if (mime && this._getExtractor(mime)) {
        return true;
    }

    return false;
};

/**
 * Get the extractor for a desired file
 *
 * @param {String} src
 * @api private
 */

Decompress.prototype._getExtractor = function (src) {
    src = src.toLowerCase();

    var ext = find(this.extractorTypes, function (ext) {
        return endsWith(src, ext);
    });

    return ext ? this.extractors[ext] : null;
};

/**
 * Extract a zip file
 *
 * @api private
 */

Decompress.prototype._extractZip = function () {
    var tmp = tempfile('.zip');
    var self = this;
    var stream = fs.createWriteStream(tmp);
    var zip;

    stream.on('close', function () {
        zip = new AdmZip(tmp);

        zip.getEntries().forEach(function (entry) {
            if (!entry.isDirectory) {
                var dest;
                var dir = path.dirname(entry.entryName.toString()).split(path.sep);
                var file = path.basename(entry.rawEntryName.toString());

                if (self.strip) {
                    dir = dir.slice(self.strip);
                }

                dest = path.join(self.path, dir.join(path.sep), file);

                mkdir.sync(path.dirname(dest));
                fs.writeFileSync(dest, entry.getData());
            }
        });

        rm.sync(tmp);
    });

    return stream;
};

/**
 * Extract a tar file
 *
 * @api private
 */

Decompress.prototype._extractTar = function () {
    var stream = tar.Extract(this.opts);
    return stream;
};

/**
 * Extract a tar.gz file
 *
 * @api private
 */

Decompress.prototype._extractTarGz = function () {
    var stream = zlib.Unzip();
    var dest = tar.Extract(this.opts);

    return pipeline(stream, dest);
};

/**
 * Module exports
 */

module.exports.extract = function (opts) {
    var decompress = new Decompress(opts);
    return decompress.extract();
};

module.exports.canExtract = function (src, mime) {
    var decompress = new Decompress();
    return decompress.canExtract(src, mime);
};