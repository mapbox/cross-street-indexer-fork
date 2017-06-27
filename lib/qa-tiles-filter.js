/**
 * Filter to (Multi)LineString & remove extra properties
 *
 * @param {Array<Feature>} features Array of Features from a single OSM QA Tile
 * @returns {Array<Feature>} filtered Features to only (Multi)LineString
 * @example
 * const lines = filterQATiles(features);
 */
module.exports = function (features) {
    const results = [];
    features.forEach(feature => {
        // Only include (Multi)LineString
        if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return;

        // Only include highway OSM data
        if (!feature.properties.highway) return;

        // Feature must have name or ref
        if (!feature.properties.name && !feature.properties.ref) return;

        // Only include certain OSM properties
        feature.properties = {
            name: feature.properties.name,
            'name:en': feature.properties['name:en'],
            'name:fr': feature.properties['name:fr'],
            highway: feature.properties.highway,
            tunel: feature.properties.tunel,
            bridge: feature.properties.bridge,
            ref: feature.properties.ref,
            '@id': feature.properties['@id']
        };
        results.push(feature);
    });
    return results;
};
