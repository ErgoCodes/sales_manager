// Metro redirects every `react-native` import to uniwind's shim (metro.config.js). If the shim drops an
// export, the app gets `undefined` at runtime: with uniwind 1.9 and React Native 0.88, `AssetRegistry`
// was missing and expo-asset failed to load every icon font in Expo Go.
describe('uniwind react-native shim', () => {
  it('forwards the React Native exports expo-asset relies on', () => {
    const shim = require('uniwind/components');
    const reactNative = require('react-native');
    expect(shim.AssetRegistry).toBeDefined();
    expect(shim.AssetRegistry).toBe(reactNative.AssetRegistry);
  });
});
