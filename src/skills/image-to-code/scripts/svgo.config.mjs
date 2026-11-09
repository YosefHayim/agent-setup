/**
 * Safe SVGO config for the image-to-code skill.
 *
 * Keeps `viewBox` (responsive scaling) and IDs (CSS/JS/animation hooks) — the two
 * things default SVGO strips that most often break animated or styled SVGs.
 *
 * Usage: npx svgo --config scripts/svgo.config.mjs -i in.svg -o out.svg
 */
export default {
  multipass: true,
  floatPrecision: 3,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          removeViewBox: false,
          cleanupIds: false,
        },
      },
    },
  ],
};
