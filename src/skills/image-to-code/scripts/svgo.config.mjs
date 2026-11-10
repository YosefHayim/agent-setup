const svgFloatPrecisionDigits = 3;

export default {
  multipass: true,
  floatPrecision: svgFloatPrecisionDigits,
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
