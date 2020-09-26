const levelup = require('level');
const queue = require('d3-queue').queue;
const path = require('path');
const tilebelt = require('tilebelt');
const fs = require('fs');
const split = require('binary-split');

// TODO: ditch the global (no quadkey) index?
function LevelIndex(options, output) {
    this.options = options;
    this.output = output;
    this.db = levelup(path.join(output, 'leveldb'));
    this.queue = queue(1);
}

LevelIndex.prototype.addTileToIndex = function(tile, callback) {
    const self = this;
    const quadkey = tilebelt.tileToQuadkey(tile);
    const quadFile = path.resolve(this.output, quadkey + '.json');
    const ops = [];

    fs.createReadStream(quadFile)
        .pipe(split())
        .on('data', function (line) {
            const json = JSON.parse(line.toString());
            const hash = Object.keys(json)[0];
            const coord = json[hash].join(',')
            const hashQuadkey = [quadkey, hash].join('+')
            ops.push({type: 'put', key: hash, value: coord});
            ops.push({type: 'put', key: hashQuadkey, value: coord});
        })
        .on('finish', function () {
          self.db.batch(ops, error => {
              if (error) throw new Error(error);
              callback(null);
          });
        });
}


LevelIndex.prototype.query = function(norm1, norm2, quadkey) {
    const db = this.db;
    return new Promise(resolve => {
        // If there's a quadkey, search the specific quad
        // Otherwise, search the global index (which is unlikely to be correct)
        const search = quadkey ?
            [quadkey, norm1, norm2].join('+') :
            [norm1, norm2].join('+');

        db.get(search, (error, value) => {
            if (error) return resolve(undefined);
            if (value) return resolve(value.split(',').map(Number));
        });
    });
};

LevelIndex.prototype.close = function () {
    this.db.close();
};

module.exports = LevelIndex;
