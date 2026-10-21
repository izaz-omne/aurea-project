import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: process.cwd() });

const eslintConfig = [
	{ ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts"] },
	...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
