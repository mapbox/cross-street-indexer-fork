const fs = require('fs');
const d3 = require('d3-queue');
const path = require('path');
const mkdirp = require('mkdirp');
const levelup = require('level');
const tilebelt = require('tilebelt');
const tileReduce = require('tile-reduce');
const {normalize} = require('./lib/normalize');
const {bbox2tiles} = require('./lib/utils');

/**
 * Cross Street indexer from OSM QA Tiles
 *
 * @param {string} mbtiles filepath to QA Tiles
 * @param {string} [output="cross-street-index"] filepath to store outputs
 * @param {*} [options] extra options
 * @param {Tile[]} [options.tiles] Filter by Tiles
 * @param {BBox} [options.bbox] Filter by BBox
 * @param {boolean} [options.debug=false] Enables DEBUG mode
 * @returns {EventEmitter} tile-reduce EventEmitter
 */
function indexer(mbtiles, output, options) {
    options = options || {};
    output = output || 'cross-street-index';
    const debug = options.debug;

    // Create folder if not exists
    if (!fs.existsSync(output)) mkdirp.sync(output);

    // Create LevelDB connection
    const db = levelup(output);

    // Tile Reduce options
    Object.assign(options, {
        zoom: 12,
        map: path.join(__dirname, 'lib', 'reducer.js'),
        sources: [{name: 'qatiles', mbtiles}],
        mapOptions: {
            output: output,
            debug: debug,
        }
    });
    const q = d3.queue(1);
    const ee = tileReduce(options);

    // Execute the following after each tile is completed
    ee.on('reduce', (result, tile) => {
        const quadkey = tilebelt.tileToQuadkey(tile);
        const ops = [];
        Object.keys(result).forEach(hash => {
            const coord = result[hash].join(',');
            const hashQuadkey = [quadkey, hash].join('+');
            ops.push({type: 'put', key: hash, value: coord});
            ops.push({type: 'put', key: hashQuadkey, value: coord});
        });
        q.defer(callback => {
            db.batch(ops, error => {
                if (error) throw new Error(error);
                callback(null);
            });
        });
    });
    ee.on('end', () => {
        q.awaitAll(error => {
            if (error) throw new Error(error);
            db.close();
        });
    });
    return ee;
}

/**
 * Load JSON from Cross Street Indexer cache
 *
 * @param {Tile|Quadkey} tile Tile [x, y, z] or Quadkey
 * @param {string} output filepath of cross-street-indexer cache
 * @returns {Map<string, [number, number]>} index Map<CrossStreet, LngLat>
 * @example
 * const index = load([654, 1584, 12], 'cross-street-index')
 * //=index
 */
function load(tile, output) {
    if (!tile) throw new Error('tile is required');
    if (!output) throw new Error('output is required');
    if (Array.isArray(tile) && typeof tile[0] !== 'number') throw new Error('must provide a single tile');

    // Convert Tile to Quadkey
    let quadkey = tile;
    if (typeof tile !== 'string') quadkey = tilebelt.tileToQuadkey(tile);
    if (typeof quadkey !== 'string') throw new Error('invalid tile or quadkey');

    // Load index cache
    const index = new Map();
    const indexPath = path.join(output, quadkey + '.json');
    if (!fs.existsSync(indexPath)) return index;

    // File Exists
    const read = fs.readFileSync(indexPath, 'utf8');
    read.split(/\n/g).forEach(line => {
        line = line.trim();
        if (line) {
            const data = JSON.parse(line);
            const key = Object.keys(data)[0];
            index.set(key, data[key]);
        }
    });
    return index;
}

/**
 * Load JSON from Cross Street Indexer cache
 *
 * @param {Tile[]|Quadkey[]|BBox} tiles Array of Tiles/Quadkeys or BBox
 * @param {string} output filepath of cross-street-indexer cache
 * @returns {Map<string, [number, number]>} index Map<CrossStreet, LngLat>
 * @example
 * const index = load([654, 1584, 12], 'cross-street-index')
 * //=index
 */
function loads(tiles, output) {
    if (!tiles) throw new Error('tiles is required');
    if (!output) throw new Error('output is required');
    if (!Array.isArray(tiles)) throw new Error('tiles must be an Array');

    // Convert BBox to Tiles
    if (typeof tiles[0] === 'number' && tiles.length === 4) tiles = bbox2tiles(tiles);

    // Combine all indexes
    const index = new Map();
    tiles.forEach(tile => {
        load(tile, output).forEach((value, key) => index.set(key, value));
    });
    return index;
}

/**
 * Search Cross Street using Map/Object Index
 *
 * @param {string} name1 Road [name/ref]
 * @param {string} name2 Road [name/ref]
 * @param {Object|Map<string, [number, number]>} [index] JSON Object or Map<CrossStreet, LngLat>
 * @returns {[number, number]|undefined} Point coordinate [lng, lat]
 * @example
 * const point = searchIndex('Chester St', 'ABBOT AVE.', index);
 * //=[-122.457711, 37.688544]
 */
function searchIndex(name1, name2, index) {
    // Normalize input
    const norm1 = normalize(name1);
    const norm2 = normalize(name2);

    // Cross Street hash
    const hash = [norm1, norm2].join('+');

    // Get Coordinate
    if (index.get) return index.get(hash);
    return index[hash];
}

/**
 * Search Cross Street using LevelDB
 *
 * @param {string} name1 Road [name/ref]
 * @param {string} name2 Road [name/ref]
 * @param {string|LevelDB} leveldb database or file path to leveldb
 * @param {string|Tile} tile Tile [x,y,z] or Quadkey
 * @returns {Promise<[number, number]|undefined>} Point coordinate [lng, lat]
 * @example
 * const point = searchIndex('Chester St', 'ABBOT AVE.', index);
 * //=[-122.457711, 37.688544]
 */
function searchLevelDB(name1, name2, leveldb, tile) {
    // Normalize input
    const norm1 = normalize(name1);
    const norm2 = normalize(name2);

    // Create Quadkey
    let quadkey;
    if (typeof tile === 'string') quadkey = tile;
    else if (Array.isArray(tile)) quadkey = tilebelt.tileToQuadkey(tile);

    // LevelDB Connection
    let db;
    if (typeof leveldb === 'string') {
        let output = leveldb;
        if (fs.existsSync(path.join(output, 'leveldb'))) output = path.join(output, 'leveldb');
        db = levelup(output);
    } else db = leveldb;

    // Get Coordinate from hash (Promise)
    // Providing tile increases accuracy
    return new Promise(resolve => {
        if (quadkey) {
            const hashQuadkey = [quadkey, norm1, norm2].join('+');
            db.get(hashQuadkey, (error, value) => {
                if (error) return resolve(undefined);
                if (value) return resolve(value.split(','));
            });
        } else {
            const hash = [norm1, norm2].join('+');
            db.get(hash, (error, value) => {
                if (error) return resolve(undefined);
                if (value) return resolve(value.split(','));
            });
        }
    });
}

module.exports = {
    load,
    loads,
    indexer,
    searchIndex,
    searchLevelDB,
};
