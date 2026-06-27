module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Inserta el contenido de los .sql de migración como string en build time.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
