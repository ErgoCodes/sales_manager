const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = withUniwindConfig(config, { cssEntryFile: './global.css' });
