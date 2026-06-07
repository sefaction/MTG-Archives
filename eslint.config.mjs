import nextVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextVitals,
  {
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
