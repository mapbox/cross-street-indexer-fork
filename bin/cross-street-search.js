#!/usr/bin/env node
const fs = require('fs');
const d3 = require('d3-queue');
const meow = require('meow');
const readline = require('readline');
const {bbox2tiles} = require('../lib/utils');
const {load, searchIndex, searchIndexDB} = require('../');

const cli = meow(`
  Usage:
    $ cross-street-search <name1> <name2>
  Options:
    --output    [cross-street-index] filepath to Cross Street index output folder
    --tiles     Lookup index files via an Array of Tiles or Quadkeys
    --bbox      Lookup index files via BBox
    --latlng    Outputs LatLng instead of the default LngLat
    --stream    Enables reading from streaming index file (ignores tiles/bbox options)
    --dbindex   Read the index database of the named type. Currently suppobrted: leveld
  Examples:
    $ cross-street-search "Chester St" "ABBOT AVE."
    $ cross-street-search "Chester" "ABBOT"
    $ cross-street-search "Chester St" "ABBOT AVE." --tiles [[654,1584,12],[653,1585,12]]
    $ cross-street-search "Chester St" "ABBOT AVE." --tiles "023010221110,023010221110"
    $ cross-street-search "Chester St" "ABBOT AVE." --bbox [-122.5,37.6,-122.1,37.9]
    $ cat 023010221110.json | cross-street-search "Chester St" "ABBOT AVE."
    $ curl -s https://s3.amazonaws.com/<your-s3-bucket>/latest/023010221110.json | cross-street-search "Chester St" "ABBOT AVE." --stream
`, {
    boolean: ['stream', 'latlng'],
    string: ['tiles']
});

// Handle user Inputs
if (!cli.input[0]) throw new Error('<name1> is required');
if (!cli.input[1]) throw new Error('<name2> is required');
const name1 = cli.input[0];
const name2 = cli.input[1];

// Handle Options
const options = cli.flags;

let tiles;

// BBox
if (options.bbox) {
    const bbox = JSON.parse(options.bbox);
    if (bbox && bbox.length !== 4) throw new Error('invalid bbox');
    tiles = bbox2tiles(bbox);
// Tiles
} else if (options.tiles) {
    // Array of [x,y,z] tiles
    if (options.tiles.match(/[\[\]]/)) tiles = JSON.parse(options.tiles);
    // Array of Quadkeys divided by commas (,)
    else tiles = options.tiles.split(/[, ]+/g);

    if (!Array.isArray(tiles)) throw new Error('invalid tiles');
    if (typeof tiles[0] === 'number') throw new Error('quadkeys must be strings');
    if (Array.isArray(tiles[0]) && tiles[0].length !== 3) throw new Error('tiles must contain 3 numbers [x,y,z]');
}

// Read index from stream
if (options.stream) {
    const stream = readline.createInterface({input: process.stdin});
    stream.on('line', line => {
        // Split concatenated streams
        // cat cross-street-index/023010221110.json < cat cross-street-index/023010221111.json
        line = line.trim();
        line.split(/\}\{/g).forEach(data => {
            const index = JSON.parse(data);
            const match = searchIndex(name1, name2, index);
            if (match) {
                if (options.latlng) match.reverse();
                process.stdout.write(match + '\n');
                stream.close();
            }
        });
    });

// Read Cross Street LevelDB index cache
} else if (options.dbindex) {
    // Validation
    let output = options.output || 'cross-street-index';
    if (!fs.existsSync(output)) throw new Error(output + ' folder does not exists');

    // No tiles provided
    if (tiles === undefined) {
        searchIndexDB(options, output, name1, name2).then(match => {
            if (match) {
                if (options.latlng) match.reverse();
                process.stdout.write(match + '\n');
            }
        });
    } else {
        // Find match on first match
        const q = d3.queue(1);
        for (const tile of tiles) {
            q.defer(callback => {
                searchIndexDB(options, output, name1, name2, tile).then(match => {
                    if (match) {
                        if (options.latlng) match.reverse();
                        process.stdout.write(match + '\n');
                        q.abort();
                    }
                    callback(null);
                });
            });
        }
    }
} else {
    // Validation
    let output = options.output || 'cross-street-index';
    if (!fs.existsSync(output)) throw new Error(output + ' folder does not exists');

    if (!tiles) throw new Error('--tiles or --bbox are required when not searching a stream or index DB');

    const q = d3.queue(1);
    for (const tile of tiles) {
        q.defer(callback => {
            const index = load(tile, output)
            const match = searchIndex(name1, name2, index);
            if (match) {
                if (options.latlng) match.reverse();
                process.stdout.write(match + '\n');
                q.abort();
            }
        });
    }
}
